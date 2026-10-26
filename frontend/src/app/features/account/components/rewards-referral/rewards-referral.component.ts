import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAward, LucideInfo, LucidePlus, LucideShare2, LucideX } from '@lucide/angular';
import { ToastService } from '../../../../shared/services/toast.service';
import { ShareModalComponent } from '../../../community/components/share-modal/share-modal.component';
import {
  LoyaltyDashboard,
  LoyaltyService
} from '../../services/loyalty.service';
import { MembershipTier } from '../../../../shared/models/user.model';

@Component({
  selector: 'app-rewards-referral',
  standalone: true,
  imports: [CommonModule, LucideAward, LucideInfo, LucidePlus, LucideShare2, LucideX, ShareModalComponent],
  templateUrl: './rewards-referral.component.html',
  styleUrl: './rewards-referral.component.scss'
})
export class RewardsReferralComponent implements OnInit {
  @Input() tier: MembershipTier = 'Seed';
  @Input() points = 0;
  @Input() referralCode = '';
  @Output() loyaltyUpdated = new EventEmitter<void>();

  private loyaltyService = inject(LoyaltyService);
  private toastService = inject(ToastService);

  loading = signal(true);
  redeemingId = signal<string | null>(null);
  showTierInfo = signal(false);
  showShareModal = signal(false);
  dashboard = signal<LoyaltyDashboard | null>(null);

  readonly referralShareTagline = 'Join me on Offsite — slow rituals, specialty matcha and coffee.';

  readonly tierModalTiers: MembershipTier[] = ['Seed', 'Leaf', 'Bloom', 'Zen'];

  readonly tierBenefits: Record<MembershipTier, string[]> = {
    Seed: ['Earn points on purchases', 'Redeem points for vouchers'],
    Leaf: ['All Seed benefits', 'Exclusive tier vouchers', '1.1× purchase points'],
    Bloom: ['All Leaf benefits', '3 free shipping vouchers each month', '1.2× purchase points'],
    Zen: ['All Bloom benefits', 'Annual birthday voucher', '1.5× purchase points']
  };

  ngOnInit(): void {
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.loyaltyService.getDashboard();
      this.dashboard.set(data);
    } catch (error) {
      console.error('Failed to load loyalty dashboard:', error);
      this.toastService.error('Could not load rewards data. Please refresh.');
    } finally {
      this.loading.set(false);
    }
  }

  get activeTier(): MembershipTier {
    return this.dashboard()?.tier || this.tier || 'Seed';
  }

  get availablePoints(): number {
    return this.dashboard()?.availablePoints ?? this.points ?? 0;
  }

  get lifetimePoints(): number {
    return this.dashboard()?.lifetimePoints ?? 0;
  }

  get pointsPerDollar(): number {
    return this.dashboard()?.pointsPerDollar ?? 1;
  }

  get activeReferralCode(): string {
    return this.dashboard()?.referralCode || this.referralCode || '';
  }

  get referralLink(): string {
    const path = '/?ref=' + encodeURIComponent(this.activeReferralCode);
    return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
  }

  get referralShareMessage(): string {
    if (!this.activeReferralCode) return '';
    return `Join Offsite with my referral code ${this.activeReferralCode}. We both earn reward points when you sign up and complete your first order. ${this.referralLink}`;
  }

  get progressLabel(): string {
    const data = this.dashboard();
    if (!data?.nextTier) return 'Top tier · benefits locked in';
    return `${data.pointsToNext.toLocaleString()} points to ${data.nextTier}`;
  }

  get progressPercent(): number {
    return this.dashboard()?.progressPercent ?? 0;
  }

  tierBadgeLabel(tier: MembershipTier): string {
    return tier.toUpperCase();
  }

  benefitsForTier(tier: MembershipTier): string[] {
    return this.tierBenefits[tier];
  }

  formatMultiplier(value: number): string {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
    return `${formatted}×`;
  }

  formatHistoryDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  statusChipClass(status: string): string {
    const normalized = status.trim().toLowerCase();
    if (normalized.includes('pending')) return 'status-chip--pending';
    if (normalized.includes('posted')) return 'status-chip--posted';
    if (normalized.includes('reversed')) return 'status-chip--reversed';
    if (normalized.includes('used')) return 'status-chip--used';
    return 'status-chip--neutral';
  }

  referralStatusChipClass(status: string): string {
    const normalized = status.trim().toLowerCase();
    if (normalized.includes('ordered')) return 'status-chip--posted';
    if (normalized.includes('order') || normalized.includes('completed') || normalized.includes('rewarded')) {
      return 'status-chip--posted';
    }
    if (normalized.includes('signed') || normalized.includes('register')) return 'status-chip--used';
    if (normalized.includes('ineligible') || normalized.includes('reversed')) return 'status-chip--reversed';
    if (normalized.includes('pending')) return 'status-chip--pending';
    return 'status-chip--neutral';
  }

  openTierInfo(): void {
    this.showTierInfo.set(true);
  }

  closeTierInfo(): void {
    this.showTierInfo.set(false);
  }

  openShareModal(): void {
    if (!this.activeReferralCode) {
      this.toastService.error('Your referral code is not available yet.');
      return;
    }
    this.showShareModal.set(true);
  }

  closeShareModal(): void {
    this.showShareModal.set(false);
  }

  async redeem(rewardId: string): Promise<void> {
    if (this.redeemingId()) return;

    this.redeemingId.set(rewardId);
    try {
      const result = await this.loyaltyService.redeemReward(rewardId);
      if (!result.ok && !result.voucherCode) {
        this.toastService.error(result.error || 'Could not redeem this reward.');
        return;
      }

      this.toastService.success(result.message || 'Reward redeemed successfully.');
      await this.loadDashboard();
      this.loyaltyUpdated.emit();
    } catch (error) {
      console.error('Redeem failed:', error);
      this.toastService.error('Could not redeem this reward.');
    } finally {
      this.redeemingId.set(null);
    }
  }

  formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatPoints(value: number): string {
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toLocaleString()}`;
  }
}
