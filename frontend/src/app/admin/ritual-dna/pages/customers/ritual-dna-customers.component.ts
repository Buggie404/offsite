import { LucideArrowRight, LucideSparkle } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AdminDnaCustomer, AdminDnaCustomerDetail, AdminDnaHistoryEntry, AdminRitualArchetype,
  AdminRitualDnaService, DnaAxis
} from '../../services/admin-ritual-dna.service';

@Component({
  selector: 'app-admin-ritual-dna-customers',
  standalone: true,
  imports: [LucideArrowRight, LucideSparkle,CommonModule, RouterLink],
  templateUrl: './ritual-dna-customers.component.html',
  styleUrl: './ritual-dna-customers.component.scss'
})
export class RitualDnaCustomersComponent implements OnInit {
  private readonly api = inject(AdminRitualDnaService);
  private listRequest = 0;
  private detailRequest = 0;
  readonly Math = Math;
  @Input() archetypes: AdminRitualArchetype[] = [];
  readonly axes: { key: DnaAxis; label: string }[] = [
    { key: 'brightness', label: 'Brightness' }, { key: 'boldness', label: 'Boldness' },
    { key: 'sweetness', label: 'Sweetness' }, { key: 'skill', label: 'Skill' },
    { key: 'tempo', label: 'Tempo' }
  ];
  readonly search = signal('');
  readonly status = signal('all');
  readonly archetype = signal('');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly limit = signal(20);
  readonly rows = signal<AdminDnaCustomer[]>([]);
  readonly loadingList = signal(false);
  readonly listError = signal('');
  readonly selectedUserId = signal<string | null>(null);
  readonly detail = signal<AdminDnaCustomerDetail | null>(null);
  readonly detailPage = signal(1);
  readonly loadingDetail = signal(false);
  readonly detailError = signal('');

  ngOnInit(): void { this.loadList(); }

  setSearch(event: Event): void { this.search.set((event.target as HTMLInputElement).value); }

  applyFilters(): void {
    this.page.set(1);
    this.selectedUserId.set(null);
    this.detail.set(null);
    this.loadList();
  }

  setStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  setArchetype(event: Event): void {
    this.archetype.set((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  changePage(step: number): void {
    const next = this.page() + step;
    if (next < 1 || next > Math.ceil(this.total() / this.limit())) return;
    this.page.set(next);
    this.loadList();
  }

  loadList(): void {
    const request = ++this.listRequest;
    this.loadingList.set(true);
    this.listError.set('');
    this.api.customers({ page: this.page(), search: this.search().trim(), status: this.status(), archetype: this.archetype() })
      .subscribe({
        next: response => {
          if (request !== this.listRequest) return;
          this.rows.set(response.data);
          this.total.set(response.total);
          this.limit.set(response.limit);
          this.loadingList.set(false);
        },
        error: error => {
          if (request !== this.listRequest) return;
          this.listError.set(error?.error?.error || 'Could not load customers.');
          this.loadingList.set(false);
        }
      });
  }

  openCustomer(userId: string): void {
    this.selectedUserId.set(userId);
    this.detail.set(null);
    this.detailPage.set(1);
    this.loadDetail();
  }

  changeHistoryPage(step: number): void {
    const detail = this.detail();
    if (!detail) return;
    const next = this.detailPage() + step;
    if (next < 1 || next > Math.ceil(detail.history_total / detail.limit)) return;
    this.detailPage.set(next);
    this.loadDetail();
  }

  loadDetail(): void {
    const userId = this.selectedUserId();
    if (!userId) return;
    const request = ++this.detailRequest;
    this.loadingDetail.set(true);
    this.detailError.set('');
    this.api.customerDetail(userId, this.detailPage()).subscribe({
      next: response => {
        if (request !== this.detailRequest || this.selectedUserId() !== userId) return;
        this.detail.set(response.data);
        this.loadingDetail.set(false);
      },
      error: error => {
        if (request !== this.detailRequest || this.selectedUserId() !== userId) return;
        this.detailError.set(error?.error?.error || 'Could not load this profile.');
        this.loadingDetail.set(false);
      }
    });
  }

  archetypeName(id: string | null): string {
    return this.archetypes.find(row => row.archetype_id === id)?.name || id || 'No DNA yet';
  }

  sourceLabel(source: string): string {
    return ({ quiz: 'Quiz completed', order: 'Order delivered', order_refund: 'Order refund',
      product_saved: 'Product saved', product_unsaved: 'Product unsaved',
      recipe_saved: 'Recipe saved', recipe_unsaved: 'Recipe unsaved' } as Record<string, string>)[source] || source;
  }

  changedAxes(log: AdminDnaHistoryEntry): { label: string; value: number }[] {
    return this.axes.map(axis => ({ label: axis.label, value: log.delta?.[axis.key] || 0 })).filter(row => row.value !== 0);
  }

  orderId(log: AdminDnaHistoryEntry): string | null {
    return (log.source === 'order' || log.source === 'order_refund') ? log.source_id : null;
  }
}
