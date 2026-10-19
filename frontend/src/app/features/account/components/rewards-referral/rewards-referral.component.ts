import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideCopy, LucideGift, LucideInfo, LucideUsers, LucideX } from '@lucide/angular';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  LoyaltyDashboard,
  LoyaltyService
} from '../../services/loyalty.service';
import { MembershipTier } from '../../../../shared/models/user.model';

interface TierTheme {
  cardBackground: string;
  accent: string;
  progressTrack: string;
  progressFill: string;
  ring: string;
}

@Component({
  selector: 'app-rewards-referral',
  standalone: true,
  imports: [CommonModule, LucideCopy, LucideGift, LucideInfo, LucideUsers, LucideX],
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
  dashboard = signal<LoyaltyDashboard | null>(null);

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

  get progressLabel(): string {
    const data = this.dashboard();
    if (!data?.nextTier) return 'Top tier reached';
    return `${data.pointsToNext.toLocaleString()} points to ${data.nextTier}`;
  }

  get progressPercent(): number {
    return this.dashboard()?.progressPercent ?? 0;
  }

  tierTheme(tier: MembershipTier): TierTheme {
    switch (tier) {
      case 'Leaf':
        return {
          cardBackground: 'linear-gradient(108deg, #c8d8bc 0%, #d9e6cf 58%, #e6efd8 100%)',
          accent: '#4f6848',
          progressTrack: 'rgba(255,255,255,0.72)',
          progressFill: '#5f7a56',
          ring: 'rgba(79,104,72,0.18)'
        };
      case 'Bloom':
        return {
          cardBackground: 'linear-gradient(108deg, #efc8cf 0%, #f6d5db 58%, #fde7ec 100%)',
          accent: '#8f4f5d',
          progressTrack: 'rgba(255,255,255,0.78)',
          progressFill: '#b56b7a',
          ring: 'rgba(143,79,93,0.16)'
        };
      case 'Zen':
        return {
          cardBackground: 'linear-gradient(108deg, #2f3d34 0%, #375545 58%, #456553 100%)',
          accent: '#edf2ea',
          progressTrack: 'rgba(255,255,255,0.18)',
          progressFill: '#cfe1b9',
          ring: 'rgba(207,225,185,0.12)'
        };
      default:
        return {
          cardBackground: 'linear-gradient(108deg, #ddc8a5 0%, #e7d3aa 58%, #f3e5b7 100%)',
          accent: '#5d5546',
          progressTrack: 'rgba(255,255,255,0.78)',
          progressFill: '#8f7a52',
          ring: 'rgba(93,85,70,0.16)'
        };
    }
  }

  benefitsForTier(tier: MembershipTier): string[] {
    return this.tierBenefits[tier];
  }

  openTierInfo(): void {
    this.showTierInfo.set(true);
  }

  closeTierInfo(): void {
    this.showTierInfo.set(false);
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

  async copyReferralLink(): Promise<void> {
    if (!this.activeReferralCode) {
      this.toastService.error('Your referral link is not available yet.');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      this.toastService.error('Clipboard access is unavailable in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(this.referralLink);
      this.toastService.success('Referral link copied.');
    } catch (error) {
      console.error('Failed to copy referral link:', error);
      this.toastService.error('Could not copy the referral link. Please try again.');
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
