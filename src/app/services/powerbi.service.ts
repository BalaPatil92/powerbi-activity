/* ============================================================
   PowerbiService — thin, typed wrapper around powerbi-client.

   Responsibilities:
     - embed a report by URL into a container element
     - reset a container
     - CAPTURE page-wise activity (filters + slicers) on render,
       debounced 800ms, persisted via StorageService
     - RESTORE saved context on load
     - expose a stream of the current ActivityPreview per user

   All Power BI SDK access is isolated here so components stay
   thin and the SDK can be mocked/replaced.
   ============================================================ */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import * as pbi from 'powerbi-client';
import * as models from 'powerbi-models';

import {
  STORAGE_PROVIDER,
  StorageService,
  StorageQuotaExceededError,
} from './storage.service';
import {
  PageContext,
  ReportContext,
  SlicerStateEntry,
} from '../models/context.model';
import { environment } from '../../environments/environment';

/**
 * Shape returned by the Python token API.
 * The backend performs the client-credentials auth + GenerateToken and
 * returns a short-lived Power BI embed token.
 */
export interface EmbedTokenResponse {
  /** The Power BI embed token (used as accessToken). */
  token: string;
  /** Token kind — the backend flow produces an 'Embed' token. */
  tokenType: 'Embed' | 'Aad';
  /** Authoritative embed URL from the Power BI REST API (optional). */
  embedUrl?: string;
  /** ISO expiry timestamp of the embed token (optional). */
  expiry?: string;
}

/** Prefix for per-user/per-report context keys: ctx_<userId>_<reportId>. */
const CTX_PREFIX = 'ctx_';

/** Debounce window for the "rendered" capture, per spec. */
const CAPTURE_DEBOUNCE_MS = 800;

@Injectable({ providedIn: 'root' })
export class PowerbiService {
  private readonly storage = inject<StorageService>(STORAGE_PROVIDER);
  private readonly http = inject(HttpClient);

  /** The powerbi-client service singleton (factory + wpmp + hpm). */
  private readonly powerbi = new pbi.service.Service(
    pbi.factories.hpmFactory,
    pbi.factories.wpmpFactory,
    pbi.factories.routerFactory
  );

  /** The currently embedded report (if any). */
  private currentReport: pbi.Report | null = null;

  /** Bookkeeping for the active embed so capture handlers have context. */
  private activeUserId = '';
  private activeReportId = '';
  private activeEmbedUrl = '';

  /**
   * A debounced capture trigger. The report "rendered" event pushes into
   * this Subject; after 800ms of quiet we run one capture. This collapses
   * bursts of render events into a single storage write.
   */
  private readonly captureTrigger$ = new Subject<void>();

  constructor() {
    // Wire the debounced capture pipeline once.
    this.captureTrigger$
      .pipe(debounceTime(CAPTURE_DEBOUNCE_MS))
      .subscribe(() => {
        // Fire-and-forget; capture is resilient and never throws upward.
        void this.captureActivePage();
      });
  }

  // ============================================================
  // EMBED TOKEN (via Python service-principal backend)
  // ============================================================

  /**
   * Calls the Python REST API to obtain a Power BI embed token.
   *
   * Server-side flow (see /backend):
   *   1. UI POSTs { reportId, groupId } to the Python API.
   *   2. Python authenticates to Azure AD with client_id + client_secret
   *      (client-credentials grant) and receives an AAD access token.
   *   3. Python calls Power BI REST GenerateToken for the report and
   *      returns a short-lived EMBED token to the UI.
   *   4. UI embeds the report using that token (tokenType = Embed).
   *
   * 🔒 The client_id/client_secret NEVER touch the browser — only the
   * short-lived embed token is returned. This is the correct place for
   * the real token; nothing privileged is exposed client-side.
   */
  async getEmbedToken(
    reportId: string,
    groupId: string
  ): Promise<EmbedTokenResponse> {
    const url = `${environment.powerbiApiBaseUrl}${environment.embedTokenPath}`;
    // POST the identifiers; the backend holds the credentials.
    return firstValueFrom(
      this.http.post<EmbedTokenResponse>(url, { reportId, groupId })
    );
  }

  // ============================================================
  // URL VALIDATION / REPORT ID EXTRACTION
  // ============================================================

  /**
   * Validates that `url` is an https URL on app.powerbi.com.
   * Returns { valid, reportId, groupId, error }.
   * If a reportId query param is present it is used; otherwise a stable
   * hash of the URL is generated as the reportId. groupId (workspace id)
   * is extracted when present — the backend needs it for GenerateToken.
   */
  validateEmbedUrl(url: string): {
    valid: boolean;
    reportId: string;
    groupId: string;
    error?: string;
  } {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return { valid: false, reportId: '', groupId: '', error: 'Not a valid URL.' };
    }

    if (parsed.protocol !== 'https:') {
      return { valid: false, reportId: '', groupId: '', error: 'URL must use https.' };
    }
    if (!parsed.hostname.includes('app.powerbi.com')) {
      return {
        valid: false,
        reportId: '',
        groupId: '',
        error: 'URL must be an app.powerbi.com embed URL.',
      };
    }

    // reportId + groupId can appear in EITHER shape:
    //   - embed URL query params:  reportEmbed?reportId=..&groupId=..
    //   - normal browser path:     /groups/<groupId>/reports/<reportId>/ReportSection
    // Support both so users can paste whichever URL they have.
    const segments = parsed.pathname.split('/').filter(Boolean);
    const pathValueAfter = (key: string): string | null => {
      const i = segments.indexOf(key);
      return i !== -1 && i + 1 < segments.length ? segments[i + 1] : null;
    };

    // reportId: query param, else path segment, else a stable hash fallback.
    const paramReportId =
      parsed.searchParams.get('reportId') ?? pathValueAfter('reports');
    const reportId = paramReportId ?? this.stableHash(url.trim());

    // groupId = the Power BI workspace id, needed by the backend GenerateToken.
    const groupId =
      parsed.searchParams.get('groupId') ?? pathValueAfter('groups') ?? '';

    return { valid: true, reportId, groupId };
  }

  /** Small deterministic string hash (djb2) -> hex, used as a fallback id. */
  private stableHash(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    // >>> 0 forces unsigned; base36 keeps it short and stable.
    return 'url_' + (hash >>> 0).toString(36);
  }

  // ============================================================
  // EMBED / RESET
  // ============================================================

  /** Resets (clears) any embed inside the given container element. */
  reset(container: HTMLElement): void {
    this.powerbi.reset(container);
    this.currentReport = null;
  }

  /**
   * Embed a report by URL into `container`.
   * Attaches render/load/page-change handlers that drive capture + restore.
   *
   * Guarded so the app never throws — returns an error string on failure.
   */
  async embedByUrl(params: {
    container: HTMLElement;
    embedUrl: string;
    reportId: string;
    /** Power BI workspace id, needed by the backend GenerateToken call. */
    groupId: string;
    userId: string;
    /**
     * OPTIONAL POC OVERRIDE: a token pasted into the UI so the report can
     * render WITHOUT the backend running. When omitted, the token is
     * fetched from the Python service-principal API (the normal flow).
     */
    manualToken?: string;
    /**
     * Which kind of token `manualToken` is:
     *  - 'Aad'   : an Azure AD user access token (user-owns-data)
     *  - 'Embed' : a backend-generated Power BI embed token (app-owns-data)
     */
    manualTokenType?: 'Aad' | 'Embed';
  }): Promise<{ ok: boolean; error?: string }> {
    const {
      container,
      embedUrl,
      reportId,
      groupId,
      userId,
      manualToken,
      manualTokenType,
    } = params;

    try {
      // Always reset first so re-embeds don't stack iframes.
      this.reset(container);

      this.activeUserId = userId;
      this.activeReportId = reportId;
      this.activeEmbedUrl = embedUrl;

      // Token resolution:
      //  1) a token pasted in the UI (POC override, no backend needed), else
      //  2) the Python service-principal API (normal flow).
      let accessToken: string;
      let tokenType: models.TokenType;
      let effectiveEmbedUrl = embedUrl;

      const trimmedManual = manualToken?.trim();
      if (trimmedManual) {
        // Manual override path.
        accessToken = trimmedManual;
        tokenType =
          manualTokenType === 'Embed'
            ? models.TokenType.Embed
            : models.TokenType.Aad;
      } else {
        // Normal path: ask the Python backend for an embed token.
        const tokenRes = await this.getEmbedToken(reportId, groupId);
        accessToken = tokenRes.token;
        tokenType =
          tokenRes.tokenType === 'Aad'
            ? models.TokenType.Aad
            : models.TokenType.Embed;
        // Prefer the authoritative embed URL the backend returned, if any.
        if (tokenRes.embedUrl) {
          effectiveEmbedUrl = tokenRes.embedUrl;
          this.activeEmbedUrl = tokenRes.embedUrl;
        }
      }

      // Build a typed embed configuration.
      const config: pbi.IEmbedConfiguration = {
        type: 'report',
        embedUrl: effectiveEmbedUrl,
        id: reportId,
        accessToken,
        tokenType,
        permissions: models.Permissions.Read,
        settings: {
          panes: {
            filters: { visible: true, expanded: false },
            pageNavigation: { visible: true },
          },
          background: models.BackgroundType.Transparent,
        },
      };

      const report = this.powerbi.embed(container, config) as pbi.Report;
      this.currentReport = report;

      this.attachHandlers(report);

      return { ok: true };
    } catch (err) {
      // Never let embedding throw into the UI.
      const message =
        err instanceof Error ? err.message : 'Failed to embed report.';
      console.error('[PowerbiService] embedByUrl failed:', err);
      return { ok: false, error: message };
    }
  }

  // ============================================================
  // EVENT HANDLERS: capture (rendered / pageChanged) + restore (loaded)
  // ============================================================

  private attachHandlers(report: pbi.Report): void {
    // Clear any prior handlers to avoid double-binding on re-embed.
    report.off('loaded');
    report.off('rendered');
    report.off('pageChanged');
    report.off('error');

    // LOADED -> restore saved context (or defaults).
    report.on('loaded', () => {
      void this.restoreContext(report);
    });

    // RENDERED -> debounced capture of the active page.
    report.on('rendered', () => {
      this.captureTrigger$.next();
    });

    // PAGE CHANGED -> capture the page the user just moved to.
    report.on('pageChanged', () => {
      // Give the page a beat to settle, then capture via the same debounce.
      this.captureTrigger$.next();
    });

    // Surface SDK errors to the console but never crash the app.
    report.on('error', (event) => {
      console.error('[PowerbiService] Power BI report error:', event?.detail);
    });
  }

  // ============================================================
  // CAPTURE
  // ============================================================

  /**
   * Capture the active page's filters + slicers and merge into the stored,
   * page-wise ReportContext in localStorage.
   */
  async captureActivePage(): Promise<void> {
    const report = this.currentReport;
    if (!report) {
      return;
    }

    try {
      const activePage = await report.getActivePage();
      if (!activePage) {
        return;
      }

      // Report-level filters.
      const reportFilters = (await report.getFilters()) as models.IFilter[];

      // Page-level filters.
      const pageFilters = (await activePage.getFilters()) as models.IFilter[];

      // Slicer states for every "slicer" visual on the active page.
      const slicerStates = await this.captureSlicerStates(activePage);

      const now = new Date().toISOString();

      const pageContext: PageContext = {
        pageName: activePage.name,
        displayName: activePage.displayName,
        pageFilters,
        slicerStates,
        lastVisited: now,
      };

      // Load-merge-save the page-wise context.
      const key = this.ctxKey(this.activeUserId, this.activeReportId);
      const existing = await this.storage.getItem<ReportContext>(key);

      const merged: ReportContext = existing
        ? {
            ...existing,
            embedUrl: this.activeEmbedUrl,
            reportFilters,
            lastActivePage: activePage.name,
            savedAt: now,
            pages: {
              ...existing.pages,
              [activePage.name]: pageContext,
            },
          }
        : {
            userId: this.activeUserId,
            reportId: this.activeReportId,
            embedUrl: this.activeEmbedUrl,
            reportFilters,
            lastActivePage: activePage.name,
            savedAt: now,
            pages: { [activePage.name]: pageContext },
          };

      await this.safeSave(key, merged);
    } catch (err) {
      console.error('[PowerbiService] captureActivePage failed:', err);
    }
  }

  /** Reads slicer state from every visual of type "slicer" on a page. */
  private async captureSlicerStates(
    page: pbi.Page
  ): Promise<SlicerStateEntry[]> {
    const entries: SlicerStateEntry[] = [];
    try {
      const visuals = await page.getVisuals();
      const slicers = visuals.filter((v) => v.type === 'slicer');

      for (const slicer of slicers) {
        try {
          const state = await slicer.getSlicerState();
          entries.push({
            visualName: slicer.name,
            title: slicer.title ?? slicer.name,
            state,
          });
        } catch (innerErr) {
          // A single slicer failing should not abort the whole capture.
          console.warn(
            `[PowerbiService] Could not read slicer "${slicer.name}":`,
            innerErr
          );
        }
      }
    } catch (err) {
      console.warn('[PowerbiService] getVisuals failed:', err);
    }
    return entries;
  }

  /**
   * Save with QuotaExceededError handling: on quota failure, evict the
   * OLDEST context (by savedAt) and retry exactly once.
   */
  private async safeSave(key: string, value: ReportContext): Promise<void> {
    try {
      await this.storage.setItem(key, value);
    } catch (err) {
      if (err instanceof StorageQuotaExceededError) {
        console.warn('[PowerbiService] Quota exceeded — evicting oldest ctx.');
        await this.evictOldestContext(key);
        // Retry once.
        await this.storage.setItem(key, value);
      } else {
        throw err;
      }
    }
  }

  /** Finds and removes the oldest ctx_* entry (skips the key being written). */
  private async evictOldestContext(keepKey: string): Promise<void> {
    const keys = await this.storage.getKeysByPrefix(CTX_PREFIX);
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const k of keys) {
      if (k === keepKey) {
        continue;
      }
      const ctx = await this.storage.getItem<ReportContext>(k);
      const t = ctx ? Date.parse(ctx.savedAt) : 0;
      if (t < oldestTime) {
        oldestTime = t;
        oldestKey = k;
      }
    }

    if (oldestKey) {
      await this.storage.removeItem(oldestKey);
    }
  }

  // ============================================================
  // RESTORE
  // ============================================================

  /**
   * On report load, re-apply saved context for the active user+report:
   * set the last active page, replace report-level filters, and re-apply
   * each saved slicer state on the active page.
   */
  private async restoreContext(report: pbi.Report): Promise<void> {
    try {
      const key = this.ctxKey(this.activeUserId, this.activeReportId);
      const ctx = await this.storage.getItem<ReportContext>(key);

      if (!ctx) {
        // Nothing saved -> load with defaults (no-op).
        return;
      }

      // 1) Restore the last active page.
      if (ctx.lastActivePage) {
        try {
          await report.setPage(ctx.lastActivePage);
        } catch (e) {
          console.warn('[PowerbiService] setPage on restore failed:', e);
        }
      }

      // 2) Replace report-level filters.
      if (ctx.reportFilters?.length) {
        try {
          await report.updateFilters(
            models.FiltersOperations.Replace,
            ctx.reportFilters
          );
        } catch (e) {
          console.warn('[PowerbiService] updateFilters on restore failed:', e);
        }
      }

      // 3) Restore slicer states on the (now active) page.
      const activePage = await report.getActivePage();
      const savedPage = activePage ? ctx.pages[activePage.name] : undefined;

      if (activePage && savedPage?.slicerStates?.length) {
        const visuals = await activePage.getVisuals();
        for (const saved of savedPage.slicerStates) {
          const visual = visuals.find(
            (v) => v.name === saved.visualName && v.type === 'slicer'
          );
          if (visual) {
            try {
              await visual.setSlicerState(saved.state);
            } catch (e) {
              console.warn(
                `[PowerbiService] setSlicerState failed for "${saved.visualName}":`,
                e
              );
            }
          }
        }
      }
    } catch (err) {
      console.error('[PowerbiService] restoreContext failed:', err);
    }
  }

  // ============================================================
  // READ-BACK (used by the AI preview/payload build)
  // ============================================================

  /** Loads every stored ReportContext for a given user. */
  async getAllContextsForUser(userId: string): Promise<ReportContext[]> {
    const keys = await this.storage.getKeysByPrefix(CTX_PREFIX);
    const results: ReportContext[] = [];
    for (const k of keys) {
      const ctx = await this.storage.getItem<ReportContext>(k);
      if (ctx && ctx.userId === userId) {
        results.push(ctx);
      }
    }
    // Newest first for a nicer preview ordering.
    results.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    return results;
  }

  /** Builds the ctx storage key. */
  private ctxKey(userId: string, reportId: string): string {
    return `${CTX_PREFIX}${userId}_${reportId}`;
  }
}
