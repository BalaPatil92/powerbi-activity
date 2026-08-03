/* ============================================================
   GalleryComponent — Report & Analytics Showcase Gallery.
   ============================================================ */

import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

interface GalleryItem {
  id: string;
  title: string;
  category: 'Finance' | 'Sales' | 'Operations' | 'Marketing' | 'Human Resource';
  description: string;
  embedUrl: string;
  thumbnailIcon: string;
  pagesCount: number;
}

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.scss',
})
export class GalleryComponent {
  private readonly router = inject(Router);

  readonly selectedCategory = signal<string>('All');

  readonly categories = ['All', 'Human Resource', 'Sales', 'Operations', 'Finance', 'Marketing'];

  readonly items: GalleryItem[] = [
    {
      id: 'hr-01',
      title: 'Human Resource',
      category: 'Human Resource',
      description: 'Analytics report tracking headcount, employee turnover, attrition rates, and recruitment metrics.',
      embedUrl: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/07043f0b-ea7f-4dcd-8223-c4b571dcbeac/ReportSection?experience=power-bi',
      thumbnailIcon: '👥',
      pagesCount: 3,
    },
    {
      id: 'sal-01',
      title: 'Sales & Return Sample',
      category: 'Sales',
      description: 'Gross sales volume, return rates, defect categories, customer refund trends, and net revenue impact.',
      embedUrl: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/c013bf6e-24eb-4793-85ec-424ccaa8d024/ReportSectiond8ab5d035cceb8586528?experience=power-bi',
      thumbnailIcon: '🔄',
      pagesCount: 4,
    },
    {
      id: 'str-01',
      title: 'Store Sales',
      category: 'Sales',
      description: 'Physical and regional store performance metrics, daily transaction volumes, average basket size, and footfall.',
      embedUrl: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/e52d3dc7-ba1b-4333-a9b8-299a0f1ac1e3/5b4ba98b5ad7f12a9ec0?experience=power-bi',
      thumbnailIcon: '🏪',
      pagesCount: 3,
    },
    {
      id: 'sup-01',
      title: 'Supplychain',
      category: 'Operations',
      description: 'End-to-end supply chain visibility including inventory turnover, warehouse capacity, lead times, and SLA benchmarks.',
      embedUrl: 'https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/37eb681d-d48e-4d44-90f4-95abac3618b3/ReportSection?experience=power-bi',
      thumbnailIcon: '🚚',
      pagesCount: 5,
    },
    {
      id: 'fin-01',
      title: 'Executive Financial Summary',
      category: 'Finance',
      description: 'Comprehensive view of revenue, EBITDA, operating expenses, and cash flow trends.',
      embedUrl: 'https://app.powerbi.com/reportEmbed?reportId=f6bfd646-b718-44dc-a378-b73e6b528204&groupId=be8908da-da25-452e-b220-163f52476cdd',
      thumbnailIcon: '💵',
      pagesCount: 4,
    },
  ];

  filterCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  get filteredItems(): GalleryItem[] {
    const cat = this.selectedCategory();
    if (cat === 'All') {
      return this.items;
    }
    return this.items.filter((item) => item.category === cat);
  }

  openInDashboard(embedUrl: string): void {
    // Navigate to dashboard home with selected report embed URL query param or state
    this.router.navigate(['/dashboard'], { queryParams: { embedUrl } });
  }
}
