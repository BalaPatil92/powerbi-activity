/* ============================================================
   DashboardComponent — Full Viewport Power BI Workspace & AI Hub.
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
import { ActivatedRoute, Router } from '@angular/router';

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

/** Recent URL history cap per user. */
const MAX_HISTORY = 5;

export interface PresetReport {
  name: string;
  url: string;
  icon: string;
  category: string;
}

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
  private readonly router = inject(Router);

  /** Report host container reference. */
  private readonly reportContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('reportHost');

  /** Current user. */
  readonly user: DemoUser = this.auth.currentUser()!;

  /** Pre-configured Workspace Reports. */
  readonly presetReports: PresetReport[] = [
    {
      name: 'Human Resource',
      category: 'HR Analytics',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/07043f0b-ea7f-4dcd-8223-c4b571dcbeac/ReportSection?experience=power-bi',
      icon: 'groups',
    },
    {
      name: 'Sales & Return Sample',
      category: 'Sales',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/c013bf6e-24eb-4793-85ec-424ccaa8d024/ReportSectiond8ab5d035cceb8586528?experience=power-bi',
      icon: 'sync_alt',
    },
    {
      name: 'Store Sales',
      category: 'Retail POS',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/e52d3dc7-ba1b-4333-a9b8-299a0f1ac1e3/5b4ba98b5ad7f12a9ec0?experience=power-bi',
      icon: 'storefront',
    },
    {
      name: 'Supplychain',
      category: 'Logistics',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/37eb681d-d48e-4d44-90f4-95abac3618b3/ReportSection?experience=power-bi',
      icon: 'local_shipping',
    },
  ];

  /** Embed URL input control. Defaults to Human Resource report. */
  readonly urlControl = new FormControl<string>(
    this.presetReports[0].url,
    {
      nonNullable: true,
      validators: [Validators.required],
    }
  );

  /** Optional manual token override controls. */
  readonly tokenControl = new FormControl<string>('', { nonNullable: true });
  readonly tokenTypeControl = new FormControl<'Aad' | 'Embed'>('Aad', {
    nonNullable: true,
  });

  /** UI state signals. */
  readonly embedError = signal<string>('');
  readonly hasEmbed = signal(false);
  readonly history = signal<string[]>([]);
  readonly sidePanelOpen = signal<boolean>(true);
  readonly showCustomUrlModal = signal<boolean>(false);
  readonly activeReportName = signal<string>(this.presetReports[0].name);

  /** Optional instruction sent to AI. */
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
    await this.loadHistory();
    const queryUrl = this.route.snapshot.queryParamMap.get('embedUrl');
    if (queryUrl) {
      this.urlControl.setValue(queryUrl);
      this.updateActiveNameFromUrl(queryUrl);
      await this.onEmbed(queryUrl);
    } else {
      // Auto embed default report
      await this.onEmbed(this.urlControl.value);
    }
  }

  toggleSidePanel(): void {
    this.sidePanelOpen.update((v) => !v);
  }

  toggleCustomUrlModal(): void {
    this.showCustomUrlModal.update((v) => !v);
  }

  selectPresetReport(preset: PresetReport): void {
    this.urlControl.setValue(preset.url);
    this.activeReportName.set(preset.name);
    void this.onEmbed(preset.url);
  }

  private updateActiveNameFromUrl(url: string): void {
    const match = this.presetReports.find((r) => r.url === url);
    if (match) {
      this.activeReportName.set(match.name);
    } else {
      this.activeReportName.set('Custom Power BI Report');
    }
  }

  // ============================================================
  // EMBED
  // ============================================================

  async onEmbed(url?: string): Promise<void> {
    this.embedError.set('');

    const raw = (url ?? this.urlControl.value).trim();
    if (!raw) {
      this.embedError.set('Please select or paste a Power BI embed URL.');
      return;
    }

    const check = this.powerbi.validateEmbedUrl(raw);
    if (!check.valid) {
      this.embedError.set(check.error ?? 'Invalid URL format.');
      return;
    }

    this.urlControl.setValue(raw);
    this.updateActiveNameFromUrl(raw);

    const result = await this.powerbi.embedByUrl({
      container: this.reportContainer().nativeElement,
      embedUrl: raw,
      reportId: check.reportId,
      groupId: check.groupId,
      userId: this.user.userId,
      manualToken: this.tokenControl.value,
      manualTokenType: this.tokenTypeControl.value,
    });

    if (!result.ok) {
      this.embedError.set(result.error ?? 'Failed to embed report.');
      this.hasEmbed.set(false);
      return;
    }

    this.hasEmbed.set(true);
    this.showCustomUrlModal.set(false);
    await this.pushHistory(raw);
  }

  async onChipClick(url: string): Promise<void> {
    this.urlControl.setValue(url);
    await this.onEmbed(url);
  }

  // ============================================================
  // URL HISTORY
  // ============================================================

  private historyKey(): string {
    return `urlHistory_${this.user.userId}`;
  }

  private async loadHistory(): Promise<void> {
    const stored = await this.storage.getItem<string[]>(this.historyKey());
    this.history.set(stored ?? []);
  }

  private async pushHistory(url: string): Promise<void> {
    const current = this.history();
    const next = [url, ...current.filter((u) => u !== url)].slice(
      0,
      MAX_HISTORY
    );
    this.history.set(next);
    await this.storage.setItem(this.historyKey(), next);
  }

  // ============================================================
  // SEND TO AI
  // ============================================================

  async onSendToAI(): Promise<void> {
    const preview = await this.chatbot.buildActivityPreview(this.user);
    this.previewData.set(preview);
    this.showPreview.set(true);
  }

  onPreviewCancel(): void {
    this.showPreview.set(false);
  }

  async onPreviewConfirm(): Promise<void> {
    this.showPreview.set(false);
    await this.runGeneration();
  }

  async onRetry(): Promise<void> {
    await this.runGeneration();
  }

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

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
