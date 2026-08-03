/* ============================================================
   DashboardComponent — the main workspace.

   - Embed URL textbox + Embed button + report container
   - URL history chips (last 5 per user)
   - "Send To AI" -> ActivityPreview modal -> ChatbotService -> ChatPanel
   ============================================================ */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { ActivatedRoute } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { PowerbiService } from '../../services/powerbi.service';
import { ChatbotService } from '../../services/chatbot.service';
import {
  STORAGE_PROVIDER,
  StorageService,
} from '../../services/storage.service';
import {
  ActivityPreview,
  DemoUser,
  SlideDeckOutline,
} from '../../models/context.model';

import { ActivityPreviewComponent } from '../activity-preview/activity-preview.component';
import {
  ChatPanelComponent,
  ChatPanelState,
} from '../chat-panel/chat-panel.component';

/** How many recent URLs to keep, per user. */
const MAX_HISTORY = 5;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ActivityPreviewComponent,
    ChatPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly powerbi = inject(PowerbiService);
  private readonly chatbot = inject(ChatbotService);
  private readonly storage = inject<StorageService>(STORAGE_PROVIDER);

  private readonly route = inject(ActivatedRoute);

  /** The report host element (typed viewChild signal, Angular 18). */
  private readonly reportContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('reportHost');

  /** Current user (guaranteed present behind the auth guard). */
  readonly user: DemoUser = this.auth.currentUser()!;

  /**
   * The embed URL input (Reactive Forms control).
   * Prefilled with a sample report URL for POC convenience — clear it or
   * paste your own, then click Embed.
   */
  readonly urlControl = new FormControl<string>(
    'https://app.powerbi.com/reportEmbed?reportId=f6bfd646-b718-44dc-a378-b73e6b528204&groupId=be8908da-da25-452e-b220-163f52476cdd',
    {
      nonNullable: true,
      validators: [Validators.required],
    }
  );

  /**
   * OPTIONAL POC token input so a report can render without a backend.
   * Paste an Azure AD access token (for ...reportEmbed org URLs) or a
   * backend embed token. Leave blank to use the mock getEmbedToken().
   */
  readonly tokenControl = new FormControl<string>('', { nonNullable: true });

  /** Declares what kind of token was pasted (Aad = user token, Embed = backend). */
  readonly tokenTypeControl = new FormControl<'Aad' | 'Embed'>('Aad', {
    nonNullable: true,
  });

  /** Inline embed error message. */
  readonly embedError = signal<string>('');

  /** Whether a report is currently embedded. */
  readonly hasEmbed = signal(false);

  /** Recent URL history chips for this user. */
  readonly history = signal<string[]>([]);

  /** Optional user instruction sent alongside the payload. */
  readonly instructionControl = new FormControl<string>('', {
    nonNullable: true,
  });

  // ---- Activity preview modal state ----
  readonly showPreview = signal(false);
  readonly previewData = signal<ActivityPreview | null>(null);

  // ---- Chat panel state ----
  readonly chatState = signal<ChatPanelState>('idle');
  readonly outline = signal<SlideDeckOutline | null>(null);
  readonly chatError = signal<string>('');

  async ngOnInit(): Promise<void> {
    // Load this user's URL history on entry.
    await this.loadHistory();
    const queryUrl = this.route.snapshot.queryParamMap.get('embedUrl');
    if (queryUrl) {
      this.urlControl.setValue(queryUrl);
      await this.onEmbed(queryUrl);
    }
  }

  // ============================================================
  // EMBED
  // ============================================================

  /** Handle the Embed button: validate, then embed by URL. */
  async onEmbed(url?: string): Promise<void> {
    this.embedError.set('');

    const raw = (url ?? this.urlControl.value).trim();
    if (!raw) {
      this.embedError.set('Please paste a Power BI embed URL.');
      return;
    }

    // Validate + extract/generate a reportId.
    const check = this.powerbi.validateEmbedUrl(raw);
    if (!check.valid) {
      this.embedError.set(check.error ?? 'Invalid URL.');
      return;
    }

    // Ensure the input reflects the URL being embedded (for chip re-embed).
    this.urlControl.setValue(raw);

    // Embed (guarded — never throws).
    const result = await this.powerbi.embedByUrl({
      container: this.reportContainer().nativeElement,
      embedUrl: raw,
      reportId: check.reportId,
      groupId: check.groupId,
      userId: this.user.userId,
      // POC override: a pasted token lets the report render without the backend.
      manualToken: this.tokenControl.value,
      manualTokenType: this.tokenTypeControl.value,
    });

    if (!result.ok) {
      this.embedError.set(result.error ?? 'Failed to embed report.');
      this.hasEmbed.set(false);
      return;
    }

    this.hasEmbed.set(true);
    // Record in per-user history.
    await this.pushHistory(raw);
  }

  /** Re-embed from a history chip. */
  async onChipClick(url: string): Promise<void> {
    this.urlControl.setValue(url);
    await this.onEmbed(url);
  }

  // ============================================================
  // URL HISTORY (per user, last 5) — key: urlHistory_<userId>
  // ============================================================

  private historyKey(): string {
    return `urlHistory_${this.user.userId}`;
  }

  private async loadHistory(): Promise<void> {
    const stored = await this.storage.getItem<string[]>(this.historyKey());
    this.history.set(stored ?? []);
  }

  private async pushHistory(url: string): Promise<void> {
    // De-duplicate, newest-first, cap at MAX_HISTORY.
    const current = this.history();
    const next = [url, ...current.filter((u) => u !== url)].slice(
      0,
      MAX_HISTORY
    );
    this.history.set(next);
    await this.storage.setItem(this.historyKey(), next);
  }

  // ============================================================
  // SEND TO AI: open preview -> confirm -> call API
  // ============================================================

  /** "Send To AI" button: build + show the activity preview first. */
  async onSendToAI(): Promise<void> {
    const preview = await this.chatbot.buildActivityPreview(this.user);
    this.previewData.set(preview);
    this.showPreview.set(true);
  }

  /** Preview "Cancel". */
  onPreviewCancel(): void {
    this.showPreview.set(false);
  }

  /** Preview "Confirm & Send to AI" -> make the single API call. */
  async onPreviewConfirm(): Promise<void> {
    this.showPreview.set(false);
    await this.runGeneration();
  }

  /** "Retry" from the chat panel re-runs the generation. */
  async onRetry(): Promise<void> {
    await this.runGeneration();
  }

  /** Build the payload and call Anthropic; drive the chat-panel state. */
  private async runGeneration(): Promise<void> {
    this.chatState.set('loading');
    this.chatError.set('');
    this.outline.set(null);

    try {
      const payload = await this.chatbot.buildPayload(this.user);
      const result = await this.chatbot.generateSlideOutline(
        payload,
        this.instructionControl.value
      );
      this.outline.set(result);
      this.chatState.set('done');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'The AI request failed. Please try again.';
      this.chatError.set(message);
      this.chatState.set('error');
    }
  }
}
