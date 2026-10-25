import { Component, EventEmitter, HostListener, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideAlertTriangle,
  LucideArrowRight,
  LucideBadgePercent,
  LucideCalendar,
  LucideCheck,
  LucideChevronDown,
  LucideCircleCheck,
  LucideClock,
  LucideCreditCard,
  LucideLoader,
  LucidePause,
  LucidePlay,
  LucidePlus,
  LucideRepeat,
  LucideSkipForward,
  LucideSparkles,
  LucideTruck,
  LucideX,
} from '@lucide/angular';
import {
  PauseOption,
  RitualBoxService,
  RitualCard,
  RitualHistoryRow,
  RitualSubscription,
  SubscriptionAction,
} from '../../services/ritual-box.service';

type MenuKind = 'frequency' | 'card' | 'pause';
type Menu = { id: string; kind: MenuKind } | null;

@Component({
  selector: 'app-ritual-box',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAlertTriangle,
    LucideArrowRight,
    LucideBadgePercent,
    LucideCalendar,
    LucideCheck,
    LucideChevronDown,
    LucideCircleCheck,
    LucideClock,
    LucideCreditCard,
    LucideLoader,
    LucidePause,
    LucidePlay,
    LucidePlus,
    LucideRepeat,
    LucideSkipForward,
    LucideSparkles,
    LucideTruck,
    LucideX,
  ],
  templateUrl: './ritual-box.component.html',
  styleUrl: './ritual-box.component.scss',
})
export class RitualBoxComponent implements OnInit {
  readonly box = inject(RitualBoxService);

  /** No saved card yet — the account page switches to the Payment cards tab. */
  @Output() addCard = new EventEmitter<void>();

  /** Delivery history row clicked — the account page opens that order (refund/return lives there). */
  @Output() viewOrder = new EventEmitter<string>();

  readonly frequencies: { days: 7 | 14 | 30; label: string }[] = [
    { days: 7, label: 'Every week' },
    { days: 14, label: 'Every 2 weeks' },
    { days: 30, label: 'Every month' },
  ];

  readonly pauseOptions: { value: PauseOption; label: string }[] = [
    { value: '1_month', label: 'For 1 month' },
    { value: '2_months', label: 'For 2 months' },
    { value: 'until_reactivated', label: 'Until I reactivate' },
  ];

  readonly cancelReasons = [
    'I have too much at home',
    'It’s too expensive',
    'I want to try something else',
    'I’d rather buy one-off',
    'Other',
  ];

  readonly openMenu = signal<Menu>(null);
  readonly busyId = signal<string | null>(null);
  readonly actionError = signal<{ id: string; message: string } | null>(null);
  readonly actionNotice = signal<{ id: string; message: string } | null>(null);
  readonly cancelTarget = signal<RitualSubscription | null>(null);
  cancelReason = '';

  ngOnInit(): void {
    // The account page already loads it for the sidebar badge.
    if (!this.box.data() && !this.box.isLoading()) this.box.load();
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.openMenu.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openMenu.set(null);
    this.cancelTarget.set(null);
  }

  toggleMenu(event: Event, id: string, kind: MenuKind): void {
    event.stopPropagation();
    const current = this.openMenu();
    this.openMenu.set(current?.id === id && current.kind === kind ? null : { id, kind });
  }

  isMenuOpen(id: string, kind: MenuKind): boolean {
    const m = this.openMenu();
    return !!m && m.id === id && m.kind === kind;
  }

  run(sub: RitualSubscription, action: SubscriptionAction, payload: Record<string, unknown> = {}): void {
    if (this.busyId()) return;
    this.openMenu.set(null);
    this.actionError.set(null);
    this.actionNotice.set(null);
    this.busyId.set(sub.subscription_id);
    const reschedules = action === 'frequency' || action === 'accept_adjustment'
      || (action === 'accept_proposal' && sub.admin_proposal?.type === 'frequency');
    this.box.act(sub.subscription_id, action, payload).subscribe({
      next: data => {
        this.busyId.set(null);
        // Show where the next delivery landed (never sooner than 48h after the change).
        const updated = data.subscriptions.find(s => s.subscription_id === sub.subscription_id);
        if (reschedules && updated?.status === 'active' && !updated.pending_changes?.frequency_days) {
          this.actionNotice.set({
            id: sub.subscription_id,
            message: `Done. Your next delivery is now ${this.shortDate(updated.next_charge_at)}.`,
          });
        }
      },
      error: err => {
        this.busyId.set(null);
        this.actionError.set({
          id: sub.subscription_id,
          message: err?.error?.error || 'Something went wrong. Please try again.',
        });
      },
    });
  }

  openCardFromBanner(event: Event, sub: RitualSubscription): void {
    event.stopPropagation();
    this.openMenu.set({ id: sub.subscription_id, kind: 'card' });
    document.getElementById(`sub-${sub.subscription_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  chooseFrequency(sub: RitualSubscription, days: number): void {
    if (days === this.effectiveFrequency(sub)) {
      this.openMenu.set(null);
      return;
    }
    this.run(sub, 'frequency', { frequency_days: days });
  }

  chooseCard(sub: RitualSubscription, card: RitualCard): void {
    if (card.is_expired) return;
    // Failed payment: picking a card (even the same one) charges it right away.
    if (card.id === sub.payment_method?.id && !this.isFailed(sub)) {
      this.openMenu.set(null);
      return;
    }
    this.run(sub, 'payment_method', { payment_method_id: card.id });
  }

  openCancel(sub: RitualSubscription): void {
    this.cancelReason = '';
    this.cancelTarget.set(sub);
  }

  confirmCancel(): void {
    const sub = this.cancelTarget();
    this.cancelTarget.set(null);
    if (sub) this.run(sub, 'cancel', this.cancelReason ? { reason: this.cancelReason } : {});
  }

  // ─── Display helpers ─────────────────────────────────────────

  isFailed(sub: RitualSubscription): boolean {
    return sub.status === 'payment_failed' || sub.status === 'suspended';
  }

  /** The frequency the user will get next, including a change queued by the 48h lock. */
  effectiveFrequency(sub: RitualSubscription): number {
    return sub.pending_changes?.frequency_days ?? sub.frequency_days;
  }

  frequencyLabel(days: number): string {
    return this.frequencies.find(f => f.days === days)?.label ?? `Every ${days} days`;
  }

  pauseLabel(option: PauseOption | null): string {
    return this.pauseOptions.find(p => p.value === option)?.label.toLowerCase() ?? '';
  }

  detailLine(sub: RitualSubscription): string {
    const parts: string[] = [];
    if (sub.variant_label) parts.push(sub.variant_label);
    if (sub.quantity > 1) parts.push(`Qty ${sub.quantity}`);
    if (sub.pricing.discount_percent > 0) {
      parts.push(`$${sub.pricing.total.toFixed(2)} after ${sub.pricing.discount_percent}% off`);
    }
    return parts.join(' · ');
  }

  scheduleLabel(sub: RitualSubscription): string {
    if (this.isFailed(sub)) return 'Delivery on hold';
    if (sub.status === 'paused') {
      return sub.resume_at ? `Paused until ${this.shortDate(sub.resume_at)}` : 'Paused until you reactivate';
    }
    return `Next delivery ${this.shortDate(sub.next_charge_at)}`;
  }

  /** Changes queued during the 48h lock, applied right after the upcoming charge. */
  pendingSummary(sub: RitualSubscription): string {
    const p = sub.pending_changes;
    if (!p) return '';
    const parts: string[] = [];
    if (p.frequency_days) parts.push(`switch to ${this.frequencyLabel(p.frequency_days).toLowerCase()}`);
    if (p.skip) parts.push('skip the following delivery');
    if (p.pause_option) parts.push(`pause ${this.pauseLabel(p.pause_option)}`);
    return parts.join(', ');
  }

  statusChip(sub: RitualSubscription): { label: string; tone: string } {
    switch (sub.status) {
      case 'payment_failed': return { label: 'Payment failed', tone: 'danger' };
      case 'suspended': return { label: 'Suspended', tone: 'danger' };
      case 'paused': return { label: 'Paused', tone: 'warning' };
      default: return { label: 'Active', tone: 'success' };
    }
  }

  historyChip(row: RitualHistoryRow): { label: string; tone: string } {
    switch (row.status) {
      case 'delivered': return { label: 'Delivered', tone: 'success' };
      case 'skipped': return { label: 'Skipped', tone: 'neutral' };
      case 'failed': return { label: 'Payment failed', tone: 'danger' };
      case 'cancelled': return { label: 'Order cancelled', tone: 'neutral' };
      case 'subscription_cancelled': return { label: 'Cancelled', tone: 'danger' };
      case 'cancelled_by_admin': return { label: 'Cancelled by Offsite', tone: 'danger' };
      case 'refund': return { label: 'Refund', tone: 'warning' };
      case 'shipping': return { label: 'Shipping', tone: 'info' };
      case 'delivery_failed': return { label: 'Delivery failed', tone: 'warning' };
      default: return { label: 'Processing', tone: 'info' };
    }
  }

  cardLabel(card: RitualCard): string {
    const brand = card.card_type === 'NAPAS' ? card.issued_bank || 'NAPAS' : card.card_type === 'credit' ? 'Credit' : 'Debit';
    return `${brand} •••• ${card.last4}`;
  }

  shortDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  failedSubs(): RitualSubscription[] {
    return (this.box.data()?.subscriptions ?? []).filter(s => this.isFailed(s));
  }

  outOfStockSubs(): RitualSubscription[] {
    return (this.box.data()?.subscriptions ?? []).filter(s => s.out_of_stock);
  }

  proposalSubs(): RitualSubscription[] {
    return (this.box.data()?.subscriptions ?? []).filter(s => !!s.admin_proposal);
  }

  proposalTitle(sub: RitualSubscription): string {
    const p = sub.admin_proposal;
    if (!p) return '';
    return p.type === 'frequency'
      ? `Offsite suggests delivering your ${sub.product_name} box ${this.frequencyLabel(p.frequency_days ?? sub.frequency_days).toLowerCase()}.`
      : `Offsite suggests resuming your ${sub.product_name} box.`;
  }

  suggestionSubs(): RitualSubscription[] {
    return (this.box.data()?.subscriptions ?? []).filter(s => !!s.suggestion && s.status === 'active');
  }
}
