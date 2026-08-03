/* ============================================================
   DocumentationComponent — Dedicated Power BI Report Documentation
   & Catalog Page.
   ============================================================ */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

export interface DocReport {
  id: string;
  name: string;
  category: string;
  url: string;
  groupId: string;
  reportId: string;
  section: string;
  description: string;
  icon: string;
  tags: string[];
}

@Component({
  selector: 'app-documentation',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documentation.component.html',
  styleUrl: './documentation.component.scss',
})
export class DocumentationComponent {
  private readonly router = inject(Router);

  readonly copiedId = signal<string | null>(null);

  readonly reports: DocReport[] = [
    {
      id: 'hr-doc',
      name: 'Human Resource',
      category: 'Human Resources',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/07043f0b-ea7f-4dcd-8223-c4b571dcbeac/ReportSection?experience=power-bi',
      groupId: 'e22f49f6-bd72-4589-b9cd-b9dd9d942b7c',
      reportId: '07043f0b-ea7f-4dcd-8223-c4b571dcbeac',
      section: 'ReportSection',
      description: 'Analytics report tracking headcount, employee turnover, attrition rates, diversity metrics, and HR recruitment pipelines.',
      icon: '👥',
      tags: ['Headcount', 'Attrition', 'Recruitment', 'Diversity'],
    },
    {
      id: 'sales-return-doc',
      name: 'Sales & Return Sample',
      category: 'Sales Analytics',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/c013bf6e-24eb-4793-85ec-424ccaa8d024/ReportSectiond8ab5d035cceb8586528?experience=power-bi',
      groupId: 'e22f49f6-bd72-4589-b9cd-b9dd9d942b7c',
      reportId: 'c013bf6e-24eb-4793-85ec-424ccaa8d024',
      section: 'ReportSectiond8ab5d035cceb8586528',
      description: 'Detailed analysis of gross sales volume, product return rates, defect categories, customer refund trends, and net revenue impact.',
      icon: '🔄',
      tags: ['Gross Sales', 'Returns', 'Refunds', 'Net Revenue'],
    },
    {
      id: 'store-sales-doc',
      name: 'Store Sales',
      category: 'Retail & Store Operations',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/e52d3dc7-ba1b-4333-a9b8-299a0f1ac1e3/5b4ba98b5ad7f12a9ec0?experience=power-bi',
      groupId: 'e22f49f6-bd72-4589-b9cd-b9dd9d942b7c',
      reportId: 'e52d3dc7-ba1b-4333-a9b8-299a0f1ac1e3',
      section: '5b4ba98b5ad7f12a9ec0',
      description: 'Physical and regional store performance metrics, daily transaction volumes, average basket size, customer footfall, and POS revenue.',
      icon: '🏪',
      tags: ['Retail', 'POS Sales', 'Footfall', 'Basket Size'],
    },
    {
      id: 'supplychain-doc',
      name: 'Supplychain',
      category: 'Logistics & Supply Chain',
      url: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/37eb681d-d48e-4d44-90f4-95abac3618b3/ReportSection?experience=power-bi',
      groupId: 'e22f49f6-bd72-4589-b9cd-b9dd9d942b7c',
      reportId: '37eb681d-d48e-4d44-90f4-95abac3618b3',
      section: 'ReportSection',
      description: 'End-to-end supply chain visibility including inventory turnover, warehouse capacity, lead times, vendor SLA metrics, and shipping costs.',
      icon: '🚚',
      tags: ['Inventory', 'Lead Times', 'Logistics', 'Vendors'],
    },
  ];

  openInDashboard(reportUrl: string): void {
    this.router.navigate(['/dashboard'], { queryParams: { embedUrl: reportUrl } });
  }

  async copyUrl(report: DocReport): Promise<void> {
    try {
      await navigator.clipboard.writeText(report.url);
      this.copiedId.set(report.id);
      setTimeout(() => {
        if (this.copiedId() === report.id) {
          this.copiedId.set(null);
        }
      }, 2000);
    } catch {
      // Fallback
      console.log('Copied URL:', report.url);
    }
  }
}
