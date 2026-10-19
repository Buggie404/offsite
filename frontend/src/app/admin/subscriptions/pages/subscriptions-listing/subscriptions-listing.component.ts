import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideAlertTriangle,
  LucideCheck,
  LucideChevronDown,
  LucidePause,
  LucidePlay,
  LucideSearch,
  LucideX
} from '@lucide/angular';
import { Subject, catchError, combineLatest, of, switchMap } from 'rxjs';
import { AdminSubscriptionService } from '../../services/admin-subscription.service';
import {
  AdminCancelEffective,
  AdminPauseAffects,
  AdminPauseOption,
  AdminSubscriptionDelivery,
  AdminSubscriptionDetail,
  AdminSubscriptionFilter,
  AdminSubscriptionRow,
  AdminSubscriptionStats,
  AdminSubscriptionStatus
} from '../../models/admin-subscription.model';

type ChipTone = 'success' | 'danger' | 'info' | 'warning';

const PAUSE_REASONS = ['Item out of stock', 'Payment problem', 'Customer asked us', 'Other'] as const;
const CANCEL_REASONS = ['Product discontinued', 'Repeated payment failure', 'Customer asked us', 'Other'] as const;

/** Admin 1.6.1 Subscriptions — list + detail drawer, pause / cancel modals. */
@Component({
  selector: 'app-subscriptions-listing',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAlertTriangle,
    LucideCheck,
    LucideChevronDown,
    LucidePause,
    LucidePlay,
    LucideSearch,
    LucideX
  ],
  templateUrl: './subscriptions-listing.component.html',
  styleUrl: './subscriptions-listing.component.scss'
})
export class SubscriptionsListingComponent implements OnInit {
  private api = inject(AdminSubscriptionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private readonly listTrigger$ = new Subject<void>();

  readonly pauseReasons = PAUSE_REASONS;
  readonly cancelReasons = CANCEL_REASONS;
  readonly frequencies = [
    { days: 7, label: 'Every week' },
    { days: 14, label: 'Every 2 weeks' },
    { days: 30, label: 'Every month' }
  ];
  readonly filters: { value: AdminSubscriptionFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'needs_action', label: 'Needs action' },
    { value: 'paused', label: 'Paused' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  rows: AdminSubscriptionRow[] = [];
  stats: AdminSubscriptionStats = { active: 0, affected_by_stock: 0, paused: 0, needs_action: 0 };
  loading = true;
  error: string | null = null;

  activeFilter: AdminSubscriptionFilter = 'all';
  search = '';

  selectedId: string | null = null;
  detail: AdminSubscriptionDetail | null = null;
  detailLoading = false;
  actionError: string | null = null;
  busy = false;

  noteDraft = '';
  noteSaved = false;

  // Pause modal
  showPauseModal = false;
  pauseReason: string = PAUSE_REASONS[0];
  pauseOption: AdminPauseOption = 'until_reactivated';
  pauseAffects: AdminPauseAffects = 'next';
  offerReplacement = true;
  pauseMessage = '';

  // Cancel modal
  showCancelModal = false;
  cancelReason: string = CANCEL_REASONS[0];
  cancelMessage = '';
  cancelEffective: AdminCancelEffective = 'now';

  ngOnInit(): void {
    this.listTrigger$
      .pipe(
        switchMap(() => {
          this.error = null;
          return this.api.getSubscriptions(this.activeFilter, this.search).pipe(
            catchError(() => {
              this.error = 'Failed to load subscriptions. Please try again.';
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        if (res) {
          this.rows = res.data;
          this.stats = res.stats;
        }
        this.loading = false;
        this.cdr.markForCheck();
      });

    // /admin/subscriptions/:id opens the drawer (links from order detail); ?search comes from the topbar.
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        const search = query.get('search') || '';
        const filter = (query.get('status') as AdminSubscriptionFilter) || 'all';
        const changed = search !== this.search || filter !== this.activeFilter || this.loading;
        this.search = search;
        this.activeFilter = this.filters.some((f) => f.value === filter) ? filter : 'all';
        if (changed) this.listTrigger$.next();

        const id = params.get('id');
        if (id && id !== this.selectedId) this.loadDetail(id);
        if (!id && this.selectedId) this.clearDetail();
      });
  }

  // ── List ────────────────────────────────────────────────────────────────

  get subtitle(): string {
    return `${this.stats.active} active · ${this.stats.affected_by_stock} affected by stock · ${this.stats.paused} paused`;
  }

  filterLabel(filter: { value: AdminSubscriptionFilter; label: string }): string {
    return filter.value === 'needs_action' ? `${filter.label} (${this.stats.needs_action})` : filter.label;
  }

  setFilter(filter: AdminSubscriptionFilter): void {
    this.updateQuery({ status: filter === 'all' ? null : filter });
  }

  onSearchInput(value: string): void {
    this.updateQuery({ search: value || null });
  }

  private updateQuery(queryParams: Record<string, string | null>): void {
    this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  selectRow(row: AdminSubscriptionRow): void {
    this.router.navigate(['/admin/subscriptions', row.subscription_id], { queryParamsHandling: 'preserve' });
  }

  closeDrawer(): void {
    this.router.navigate(['/admin/subscriptions'], { queryParamsHandling: 'preserve' });
  }

  // ── Detail ──────────────────────────────────────────────────────────────

  private loadDetail(id: string): void {
    this.selectedId = id;
    this.detailLoading = true;
    this.actionError = null;
    this.api
      .getSubscription(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.setDetail(res.data),
        error: () => {
          this.detail = null;
          this.detailLoading = false;
          this.actionError = 'Subscription not found.';
          this.cdr.markForCheck();
        }
      });
  }

  private setDetail(detail: AdminSubscriptionDetail): void {
    this.detail = detail;
    this.detailLoading = false;
    this.noteDraft = detail.internal_note;
    this.noteSaved = false;
    this.cdr.markForCheck();
  }

  private clearDetail(): void {
    this.selectedId = null;
    this.detail = null;
    this.actionError = null;
  }

  get isClosed(): boolean {
    return !!this.detail && ['cancelled', 'cancelled_by_admin'].includes(this.detail.status);
  }

  get firstName(): string {
    return this.detail?.customer.name.split(/\s+/).pop() || 'customer';
  }

  private run(action: 'pause' | 'reactivate' | 'frequency' | 'cancel' | 'note', payload: Record<string, unknown>, done?: () => void): void {
    if (!this.detail || this.busy) return;
    this.busy = true;
    this.actionError = null;
    this.api.runAction(this.detail.subscription_id, action, payload).subscribe({
      next: (res) => {
        this.busy = false;
        this.setDetail(res.data);
        done?.();
        if (action !== 'note') this.listTrigger$.next();
      },
      error: (err) => {
        this.busy = false;
        this.actionError = err?.error?.error || 'Something went wrong. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  changeFrequency(days: string | number): void {
    this.run('frequency', { frequency_days: Number(days) });
  }

  reactivate(): void {
    this.run('reactivate', {});
  }

  saveNote(): void {
    if (!this.detail || this.noteDraft.trim() === this.detail.internal_note) return;
    this.run('note', { note: this.noteDraft }, () => (this.noteSaved = true));
  }

  // ── Pause modal ─────────────────────────────────────────────────────────

  openPauseModal(): void {
    if (!this.detail) return;
    this.pauseReason = this.detail.out_of_stock ? 'Item out of stock' : 'Customer asked us';
    this.pauseOption = 'until_reactivated';
    this.pauseAffects = 'next';
    this.offerReplacement = !!this.detail.replacement && this.pauseReason === 'Item out of stock';
    this.pauseMessage = this.pauseTemplate();
    this.actionError = null;
    this.showPauseModal = true;
  }

  onPauseReasonChange(reason: string): void {
    this.pauseReason = reason;
    this.offerReplacement = !!this.detail?.replacement && reason === 'Item out of stock';
    this.pauseMessage = this.pauseTemplate();
  }

  onPauseAffectsChange(value: AdminPauseAffects): void {
    this.pauseAffects = value;
    // The replacement covers the box being paused, so it only applies to the upcoming delivery.
    if (value === 'following') this.offerReplacement = false;
    this.pauseMessage = this.pauseTemplate();
  }

  /** Offer box applies only when the upcoming delivery is the one paused. */
  get canOfferReplacement(): boolean {
    return !!this.detail?.replacement && this.pauseAffects === 'next';
  }

  onOfferReplacementChange(value: boolean): void {
    this.offerReplacement = value;
    this.pauseMessage = this.pauseTemplate();
  }

  private pauseTemplate(): string {
    const d = this.detail;
    if (!d) return '';
    const delivery = this.shortDate(d.upcoming_delivery_at);
    const rep = d.replacement;
    if (this.pauseAffects === 'following') {
      return `Hi ${this.firstName}, your ${delivery} box still ships as planned. After that we’ll pause your ${d.product_name} Ritual Box, and nothing is charged while it’s paused.`;
    }
    switch (this.pauseReason) {
      case 'Item out of stock': {
        const base = `Hi ${this.firstName}, ${d.product_name} is out of stock for your ${delivery} box. We paused it so you’re not charged.`;
        return this.offerReplacement && rep
          ? `${base} Would you like ${rep.name} (${rep.same_price ? 'similar pick, same price' : 'similar pick'}) instead?`
          : base;
      }
      case 'Payment problem':
        return `Hi ${this.firstName}, we couldn’t charge your card for the ${delivery} box, so we paused your Ritual Box. Update your card to continue.`;
      case 'Customer asked us':
        return `Hi ${this.firstName}, as requested we paused your ${d.product_name} Ritual Box. Nothing is charged while it’s paused.`;
      default:
        return `Hi ${this.firstName}, we paused your ${d.product_name} Ritual Box. Nothing is charged while it’s paused.`;
    }
  }

  confirmPause(): void {
    this.run(
      'pause',
      {
        reason: this.pauseReason,
        pause_option: this.pauseOption,
        affects: this.pauseAffects,
        offer_replacement: this.offerReplacement && this.canOfferReplacement,
        message: this.pauseMessage
      },
      () => (this.showPauseModal = false)
    );
  }

  // ── Cancel modal ────────────────────────────────────────────────────────

  openCancelModal(): void {
    if (!this.detail) return;
    this.cancelReason = CANCEL_REASONS[0];
    this.cancelEffective = 'now';
    this.cancelMessage = this.cancelTemplate();
    this.actionError = null;
    this.showCancelModal = true;
  }

  onCancelReasonChange(reason: string): void {
    this.cancelReason = reason;
    this.cancelMessage = this.cancelTemplate();
  }

  onCancelEffectiveChange(value: AdminCancelEffective): void {
    this.cancelEffective = value;
    this.cancelMessage = this.cancelTemplate();
  }

  /** "After the next delivery" needs an upcoming charge. */
  get canCancelAfterNext(): boolean {
    return this.detail?.status === 'active';
  }

  private cancelTemplate(): string {
    const name = this.detail?.box || 'this item';
    if (this.cancelEffective === 'after_next' && this.detail) {
      return `Your ${name} Ritual Box ends after the ${this.shortDate(this.detail.upcoming_delivery_at)} delivery, which still ships as planned. No charges after that.`;
    }
    switch (this.cancelReason) {
      case 'Product discontinued':
        return `${name} is being discontinued, so we’ve cancelled this Ritual Box. You can start a new one with any coffee or matcha from the shop.`;
      case 'Repeated payment failure':
        return `We couldn’t charge your card after several tries, so we’ve cancelled this Ritual Box. You can start a new one any time.`;
      case 'Customer asked us':
        return `As requested, we’ve cancelled your ${name} Ritual Box. No further charges will be made.`;
      default:
        return `We’ve cancelled your ${name} Ritual Box. No further charges will be made.`;
    }
  }

  confirmCancel(): void {
    this.run(
      'cancel',
      { reason: this.cancelReason, message: this.cancelMessage, effective: this.cancelEffective },
      () => (this.showCancelModal = false)
    );
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showPauseModal || this.showCancelModal) {
      this.showPauseModal = false;
      this.showCancelModal = false;
    }
  }

  // ── Formatting ──────────────────────────────────────────────────────────

  frequencyShort(days: number): string {
    return days === 7 ? 'Weekly' : days === 14 ? '2 weeks' : days === 30 ? 'Monthly' : `${days} days`;
  }

  shortDate(value: string | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  everyNext(row: AdminSubscriptionRow): string {
    return `${this.frequencyShort(row.frequency_days)} · ${row.next_charge_at ? this.shortDate(row.next_charge_at) : '—'}`;
  }

  statusChip(status: AdminSubscriptionStatus): { label: string; tone: ChipTone } {
    switch (status) {
      case 'active': return { label: 'Active', tone: 'success' };
      case 'paused': return { label: 'Paused', tone: 'warning' };
      case 'payment_failed': return { label: 'Payment failed', tone: 'danger' };
      case 'suspended': return { label: 'Suspended', tone: 'danger' };
      case 'cancelled_by_admin': return { label: 'Cancelled by staff', tone: 'danger' };
      default: return { label: 'Cancelled', tone: 'danger' };
    }
  }

  deliveryChip(result: AdminSubscriptionDelivery['result']): { label: string; tone: ChipTone } {
    switch (result) {
      case 'delivered': return { label: 'Delivered', tone: 'success' };
      case 'shipping': return { label: 'Shipping', tone: 'info' };
      case 'refund': return { label: 'Refund', tone: 'warning' };
      case 'cancelled': return { label: 'Cancelled', tone: 'danger' };
      case 'failed': return { label: 'Failed', tone: 'danger' };
      default: return { label: 'Processing', tone: 'info' };
    }
  }

  messageLabel(action: string): string {
    switch (action) {
      case 'pause': return 'Paused';
      case 'cancel': return 'Cancelled';
      default: return 'Reactivated';
    }
  }

  /** "Pauses after Nov 2 delivery" — staff or lock-window changes waiting for the next charge. */
  pendingHint(d: AdminSubscriptionDetail): string | null {
    const p = d.pending_changes;
    if (!p || d.status !== 'active') return null;
    const after = `after the ${this.shortDate(d.upcoming_delivery_at)} delivery`;
    if (p.cancel) return `Cancels ${after}`;
    if (p.pause_option) return `Pauses ${after}`;
    if (p.skip) return `Skips the delivery ${after}`;
    if (p.frequency_days) return `Switches to ${this.frequencyShort(p.frequency_days).toLowerCase()} ${after}`;
    return null;
  }

  itemLabel(d: AdminSubscriptionDetail): string {
    const name = [d.product_name, d.variant_label].filter(Boolean).join(' · ');
    return d.quantity > 1 ? `${d.quantity} × ${name}` : name;
  }

  formatPrice(value: number): string {
    return `$${value.toFixed(2)}`;
  }
}
