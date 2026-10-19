export interface UserAddress {
  _id?: string;
  recipient_name: string;
  phone: string;
  city: string;
  detail_address: string;
  label?: 'home' | 'office' | 'other' | null;
  is_default?: boolean;
}

export interface UserPaymentMethod {
  _id?: string;
  card_type: 'NAPAS' | 'credit' | 'debit';
  card_number: string;
  cardholder_name: string;
  expire_date: string;
  issued_bank?: string | null;
  cvc?: string | null;
  is_default?: boolean;
}

export type MembershipTier = 'Seed' | 'Leaf' | 'Bloom' | 'Zen';

// Keep in sync with TIER_MULTIPLIER in backend points.service.js.
export const TIER_POINT_MULTIPLIER: Record<MembershipTier, number> = { Seed: 1, Leaf: 1.1, Bloom: 1.2, Zen: 1.5 };

export const TIER_LIFETIME_THRESHOLDS: Record<MembershipTier, number> = {
  Seed: 0,
  Leaf: 150,
  Bloom: 400,
  Zen: 1000
};

export interface UserProfile {
  _id: string;
  user_id: string;
  email: string;
  phone?: string;
  profile_name: string;
  role: string;
  addresses: UserAddress[];
  payment_methods: UserPaymentMethod[];
  membership_tier?: MembershipTier;
  /** Posted (spendable) points; can be negative after a reversal. */
  points?: number;
  referral_code?: string;
  referred_by?: string;
}
