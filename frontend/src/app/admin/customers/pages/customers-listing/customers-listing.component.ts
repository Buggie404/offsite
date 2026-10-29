import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { LucideChevronLeft, LucideChevronRight, LucideEllipsis, LucideSearch, LucideUsers } from '@lucide/angular';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { AdminCustomersService, CustomerRow, CustomerStatus, CustomerTier } from '../../services/admin-customers.service';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-customers-listing',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideChevronLeft, LucideChevronRight, LucideEllipsis, LucideSearch, LucideUsers],
  templateUrl: './customers-listing.component.html',
  styleUrl: './customers-listing.component.scss'
})
export class CustomersListingComponent implements OnInit {
  private customersService = inject(AdminCustomersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private search$ = new Subject<string>();
  private requestVersion = 0;

  readonly tiers: (CustomerTier | '')[] = ['', 'Seed', 'Leaf', 'Bloom', 'Zen'];
  readonly statuses: { value: CustomerStatus | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Locked' }
  ];

  q = '';
  tier: CustomerTier | '' = '';
  status: CustomerStatus | '' = '';
  page = 1;
  total = 0;
  rows: CustomerRow[] = [];
  loading = true;
  error = '';
  brokenAvatars = new Set<string>();

  ngOnInit(): void {
    // Filters live in the URL so "Back to customers" returns to the same list.
    const params = this.route.snapshot.queryParamMap;
    this.q = params.get('q') || '';
    this.tier = (this.tiers.includes(params.get('tier') as CustomerTier) ? params.get('tier') : '') as CustomerTier | '';
    this.status = (['active', 'suspended'].includes(params.get('status') || '') ? params.get('status') : '') as CustomerStatus | '';
    this.page = Math.max(Number(params.get('page')) || 1, 1);

    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.load();
  }

  load(): void {
    const version = ++this.requestVersion;
    this.loading = true;
    this.error = '';
    this.customersService.list({ page: this.page, q: this.q.trim(), tier: this.tier, status: this.status }).subscribe({
      next: (res) => {
        if (version !== this.requestVersion) return;
        this.rows = res.data;
        this.total = res.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (version !== this.requestVersion) return;
        this.loading = false;
        this.error = err?.error?.error || 'Customers could not be loaded.';
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(value: string): void {
    this.q = value;
    this.search$.next(value.trim());
  }

  setTier(tier: CustomerTier | ''): void {
    this.tier = tier;
    this.applyFilters();
  }

  setStatus(status: CustomerStatus | ''): void {
    this.status = status;
    this.applyFilters();
  }

  applyFilters(): void {
    this.page = 1;
    this.syncUrl();
    this.load();
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: { q: this.q.trim() || null, tier: this.tier || null, status: this.status || null, page: this.page > 1 ? this.page : null }
    });
  }

  open(row: CustomerRow): void {
    void this.router.navigate(['/admin/customers', row.user_id], { queryParamsHandling: 'preserve' });
  }

  // ── Display ──

  initials(row: CustomerRow): string {
    return avatarInitials(row.profile_name);
  }

  handle(row: CustomerRow): string {
    return [row.community_name ? `@${row.community_name}` : null, row.email].filter(Boolean).join(' · ') || row.user_id;
  }

  shortDate(value: string | null): string {
    if (!value) return 'Never';
    const date = new Date(value);
    if (date.toDateString() === new Date().toDateString()) {
      return `Today ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    }
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Pagination ──

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / PAGE_SIZE));
  }

  get rangeText(): string {
    if (!this.total) return 'No customers';
    const start = (this.page - 1) * PAGE_SIZE + 1;
    return `Showing ${start}-${Math.min(this.page * PAGE_SIZE, this.total)} of ${this.total.toLocaleString('en-US')}`;
  }

  get pages(): (number | null)[] {
    const count = this.pageCount;
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
    const around = [this.page - 1, this.page, this.page + 1].filter((p) => p > 1 && p < count);
    const list: (number | null)[] = [1];
    if (around[0] > 2) list.push(null);
    list.push(...around);
    if (around[around.length - 1] < count - 1) list.push(null);
    list.push(count);
    return list;
  }

  goTo(page: number): void {
    if (page < 1 || page > this.pageCount || page === this.page) return;
    this.page = page;
    this.syncUrl();
    this.load();
  }
}
