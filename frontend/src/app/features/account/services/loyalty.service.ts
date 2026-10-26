import { Injectable, inject } from '@angular/core';
import { HttpService } from '../../../core/http.service';
import { MembershipTier } from '../../../shared/models/user.model';

export interface LoyaltyRedeemReward {
  id: string;
  title: string;
  subtitle: string;
  pointsCost: number;
  canRedeem: boolean;
}

export interface LoyaltyPointsHistoryRow {
  id: string;
  date: string;
  activity: string;
  points: number;
  status: string;
}

export interface LoyaltyAvailableVoucher {
  code: string;
  title: string;
  subtitle: string;
  voucherType: string;
  discountValue: number;
  minOrderAmount: number;
  validTo: string;
}

export interface LoyaltyReferralActivityRow {
  id: string;
  friend: string;
  status: string;
  points: number;
}

export interface LoyaltyDashboard {
  tier: MembershipTier;
  availablePoints: number;
  lifetimePoints: number;
  pointsPerDollar: number;
  referralCode: string;
  nextTier: MembershipTier | null;
  pointsToNext: number;
  progressPercent: number;
  redeemRewards: LoyaltyRedeemReward[];
  pointsHistory: LoyaltyPointsHistoryRow[];
  referralActivity: LoyaltyReferralActivityRow[];
  welcomeVoucherCode?: string | null;
  availableVouchers?: LoyaltyAvailableVoucher[];
}

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  private http = inject(HttpService);

  getDashboard(): Promise<LoyaltyDashboard> {
    return this.http.get('/loyalty/dashboard');
  }

  redeemReward(rewardId: string): Promise<{ ok: boolean; voucherCode?: string; message?: string; availablePoints?: number; error?: string }> {
    return this.http.post('/loyalty/redeem', { rewardId });
  }

  completeRitualDnaQuiz(): Promise<{ ok: boolean; points?: number; error?: string }> {
    return this.http.post('/loyalty/quiz-complete', {});
  }
}
