/* ============================================================
   ActivityPreviewComponent — modal that previews ALL captured
   activity for the current user BEFORE anything is sent to the AI.

   Shows:
     - header: user { userId, name } + collectedAt
     - grouped by reportId -> page-wise, with filters, slicers,
       lastVisited
     - a human-readable summary list
     - an expandable pretty-printed JSON view
   Emits confirm / cancel.
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

import { ActivityPreview } from '../../models/context.model';

@Component({
  selector: 'app-activity-preview',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity-preview.component.html',
  styleUrl: './activity-preview.component.scss',
})
export class ActivityPreviewComponent {
  /** The preview data to render (required input). */
  readonly preview = input.required<ActivityPreview>();

  /** Emitted when the user confirms sending to AI. */
  readonly confirmSend = output<void>();

  /** Emitted when the user cancels. */
  readonly cancel = output<void>();

  /** Toggles the raw JSON view. */
  readonly showJson = signal(false);

  /** Pretty-printed JSON of the preview payload. */
  readonly prettyJson = computed(() =>
    JSON.stringify(this.preview(), null, 2)
  );

  /** True when there is no captured activity at all. */
  readonly isEmpty = computed(() => this.preview().reports.length === 0);

  toggleJson(): void {
    this.showJson.update((v) => !v);
  }

  onConfirm(): void {
    this.confirmSend.emit();
  }

  onCancel(): void {
    this.cancel.emit();
  }

  /** Short helper: count total captured pages across all reports. */
  totalPages(): number {
    return this.preview().reports.reduce(
      (sum, r) => sum + r.pages.length,
      0
    );
  }
}
