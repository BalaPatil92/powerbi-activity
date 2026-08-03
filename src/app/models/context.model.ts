/* ============================================================
   Domain models / interfaces used across the app.
   Kept framework-agnostic so they can be shared with a future
   backend or a Redis-backed storage implementation.
   ============================================================ */

import type { IFilter, ISlicerState } from 'powerbi-models';

/** A hardcoded demo user (POC auth only — NOT real authentication). */
export interface DemoUser {
  userId: string;
  name: string;
}

/**
 * The captured state of a single report page.
 * Multiple of these live inside a report context, keyed by page name.
 */
export interface PageContext {
  /** Internal page name (e.g. "ReportSection2b0c..."). */
  pageName: string;
  /** Human-friendly page title shown in the report tab strip. */
  displayName: string;
  /** Page-level filters captured via page.getFilters(). */
  pageFilters: IFilter[];
  /** Slicer states for every "slicer" visual on the page. */
  slicerStates: SlicerStateEntry[];
  /** ISO timestamp of the last time this page was visited/captured. */
  lastVisited: string;
}

/** One slicer visual's persisted state. */
export interface SlicerStateEntry {
  /** Stable visual name (from visual.name) used to re-target on restore. */
  visualName: string;
  /** Visual title for display in the preview. */
  title: string;
  /** The powerbi-models slicer state blob. */
  state: ISlicerState;
}

/**
 * Full per-user, per-report context.
 * Activity is organized PAGE-WISE inside `pages`.
 * Stored under key: ctx_<userId>_<reportId>
 */
export interface ReportContext {
  userId: string;
  reportId: string;
  embedUrl: string;
  /** Report-level filters (apply across all pages). */
  reportFilters: IFilter[];
  /** Page-wise map: pageName -> PageContext. */
  pages: Record<string, PageContext>;
  /** Name of the last active page (used to restore setPage). */
  lastActivePage: string;
  /** ISO timestamp of the most recent write (used for LRU eviction). */
  savedAt: string;
}

/**
 * A flattened, human-readable preview row of captured activity,
 * shown in the ActivityPreview modal before sending to the AI.
 */
export interface ActivityPreview {
  user: DemoUser;
  collectedAt: string;
  reports: Array<{
    reportId: string;
    embedUrl: string;
    reportFilters: IFilter[];
    pages: Array<{
      pageName: string;
      displayName: string;
      pageFilters: IFilter[];
      slicerStates: SlicerStateEntry[];
      lastVisited: string;
    }>;
  }>;
}

/**
 * The exact JSON payload sent to the Anthropic API (user content).
 */
export interface ChatPayload {
  user: DemoUser;
  collectedAt: string;
  reports: Array<{
    reportId: string;
    embedUrl: string;
    reportFilters: IFilter[];
    pages: Record<string, PageContext>;
  }>;
}

/** A single slide in the AI-generated outline. */
export interface SlideOutline {
  title: string;
  bullets: string[];
  suggestedVisual: string;
}

/** The strict-JSON shape the AI is asked to return. */
export interface SlideDeckOutline {
  slides: SlideOutline[];
}
