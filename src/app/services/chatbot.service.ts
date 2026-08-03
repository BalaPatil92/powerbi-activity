/* ============================================================
   ChatbotService — gathers ALL of a user's page-wise contexts,
   builds a preview + payload, calls the Anthropic Messages API,
   and parses a strict-JSON slide outline.

   ⚠️ SECURITY NOTE: This POC calls the Anthropic API DIRECTLY from
   the browser with a client-side key. That exposes your API key to
   anyone using the app. Before production, move this call BEHIND A
   BACKEND PROXY (your server holds the key; the browser calls your
   server). See README "Security" section.
   ============================================================ */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { PowerbiService } from './powerbi.service';
import {
  ActivityPreview,
  ChatPayload,
  DemoUser,
  ReportContext,
  SlideDeckOutline,
} from '../models/context.model';

/** Anthropic Messages API endpoint. */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** Model per spec. */
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

/** Anthropic API version header value. */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * ⚠️ POC ONLY: client-side API key placeholder.
 * Replace by moving the call behind a backend proxy that injects the key
 * server-side. Do NOT ship a real key here.
 */
const ANTHROPIC_API_KEY = 'REPLACE_WITH_BACKEND_PROXY';

/** The exact system prompt from the spec. */
const SYSTEM_PROMPT =
  'You are a presentation-building agent. You receive a user\'s Power BI dashboard activity as JSON, organized report-by-report and page-by-page with filter and slicer selections. Produce a slide-by-slide PPT outline: one slide per report page that has activity, with title, key filter selections as bullets, and a suggested chart/visual. Return STRICT JSON only: { slides: [ { title, bullets: [], suggestedVisual } ] } with no markdown fences.';

@Injectable({ providedIn: 'root' })
export class ChatbotService {
  private readonly http = inject(HttpClient);
  private readonly powerbi = inject(PowerbiService);

  // ============================================================
  // PREVIEW: gather all contexts and shape them for the modal.
  // ============================================================

  /**
   * Build a human-previewable ActivityPreview for the current user by
   * reading every stored, page-wise ReportContext.
   */
  async buildActivityPreview(user: DemoUser): Promise<ActivityPreview> {
    const contexts = await this.powerbi.getAllContextsForUser(user.userId);

    return {
      user,
      collectedAt: new Date().toISOString(),
      reports: contexts.map((ctx) => ({
        reportId: ctx.reportId,
        embedUrl: ctx.embedUrl,
        reportFilters: ctx.reportFilters,
        // Flatten the page map into an array for readable rendering.
        pages: Object.values(ctx.pages).map((p) => ({
          pageName: p.pageName,
          displayName: p.displayName,
          pageFilters: p.pageFilters,
          slicerStates: p.slicerStates,
          lastVisited: p.lastVisited,
        })),
      })),
    };
  }

  // ============================================================
  // PAYLOAD: exact structure sent to the model.
  // ============================================================

  /** Build the ChatPayload (report-by-report, page-by-page). */
  async buildPayload(user: DemoUser): Promise<ChatPayload> {
    const contexts: ReportContext[] =
      await this.powerbi.getAllContextsForUser(user.userId);

    return {
      user,
      collectedAt: new Date().toISOString(),
      reports: contexts.map((ctx) => ({
        reportId: ctx.reportId,
        embedUrl: ctx.embedUrl,
        reportFilters: ctx.reportFilters,
        pages: ctx.pages, // keep the page-wise map intact for the model
      })),
    };
  }

  // ============================================================
  // API CALL: one Anthropic Messages request; parse strict JSON.
  // ============================================================

  /**
   * Make ONE Anthropic API call with the payload (+ optional user
   * instruction) and return a typed, parsed SlideDeckOutline.
   *
   * Throws on network/API failure so the caller can show a retry button.
   */
  async generateSlideOutline(
    payload: ChatPayload,
    userInstruction: string
  ): Promise<SlideDeckOutline> {
    // Compose the user message: optional instruction + the full payload JSON.
    const instruction = userInstruction.trim();
    const userContent =
      (instruction ? `${instruction}\n\n` : '') +
      `Here is the dashboard activity JSON:\n${JSON.stringify(
        payload,
        null,
        2
      )}`;

    const body = {
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    };

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for direct browser calls; a backend proxy removes this need.
      'anthropic-dangerous-direct-browser-access': 'true',
    });

    // Anthropic response shape: { content: [{ type: 'text', text: '...' }], ... }
    const response = await firstValueFrom(
      this.http.post<AnthropicMessageResponse>(ANTHROPIC_URL, body, { headers })
    );

    const rawText = this.extractText(response);
    return this.parseOutline(rawText);
  }

  // ============================================================
  // PARSING HELPERS
  // ============================================================

  /** Pull the concatenated text out of the Anthropic content blocks. */
  private extractText(response: AnthropicMessageResponse): string {
    if (!response?.content?.length) {
      throw new Error('Empty response from the AI.');
    }
    return response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  /**
   * Defensively parse the model output into a SlideDeckOutline.
   * Strips ```json fences if present and validates the shape.
   */
  private parseOutline(raw: string): SlideDeckOutline {
    let text = raw.trim();

    // Strip markdown code fences if the model added them despite instructions.
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    // As a last resort, isolate the outermost JSON object.
    if (!text.startsWith('{')) {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        text = text.slice(first, last + 1);
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('AI response was not valid JSON.');
    }

    // Validate/normalize into a typed SlideDeckOutline.
    const obj = parsed as { slides?: unknown };
    if (!obj || !Array.isArray(obj.slides)) {
      throw new Error('AI response did not contain a "slides" array.');
    }

    const slides = obj.slides.map((s) => {
      const slide = s as {
        title?: unknown;
        bullets?: unknown;
        suggestedVisual?: unknown;
      };
      return {
        title: typeof slide.title === 'string' ? slide.title : 'Untitled slide',
        bullets: Array.isArray(slide.bullets)
          ? slide.bullets.map((b) => String(b))
          : [],
        suggestedVisual:
          typeof slide.suggestedVisual === 'string'
            ? slide.suggestedVisual
            : 'N/A',
      };
    });

    return { slides };
  }
}

/** Minimal typing for the Anthropic Messages API response. */
interface AnthropicMessageResponse {
  id: string;
  role: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  stop_reason?: string;
}
