/* ============================================================
   ChatPanelComponent — renders the AI slide-outline result.

   States: idle | loading | error | done
   - loading: spinner
   - error: message + Retry button
   - done: slide-outline cards + Copy JSON button
   ============================================================ */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { SlideDeckOutline } from '../../models/context.model';

export type ChatPanelState = 'idle' | 'loading' | 'error' | 'done';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss',
})
export class ChatPanelComponent {
  /** Current panel state, controlled by the parent dashboard. */
  readonly state = input<ChatPanelState>('idle');

  /** The parsed slide outline (present when state === 'done'). */
  readonly outline = input<SlideDeckOutline | null>(null);

  /** Error message (present when state === 'error'). */
  readonly errorMessage = input<string>('');

  /** Emitted when the user clicks Retry. */
  readonly retry = output<void>();

  /** Transient "Copied!" confirmation flag. */
  readonly copied = signal(false);

  /** Convenience: the slides array or empty. */
  readonly slides = computed(() => this.outline()?.slides ?? []);

  onRetry(): void {
    this.retry.emit();
  }

  /** Copy the full outline JSON to the clipboard (for a future PPT service). */
  async copyJson(): Promise<void> {
    const data = this.outline();
    if (!data) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    } catch (err) {
      console.error('[ChatPanel] Clipboard write failed:', err);
    }
  }
}
