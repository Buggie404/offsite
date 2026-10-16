import { Product } from '../../../shared/models/product.model';

export type PurchaseType = 'one_time' | 'subscription';
export type SubscriptionFrequencyDays = 7 | 14 | 30;

// Shop-wide Subscribe & Save discount used when Product.subscribe_discount_percent is null.
// Keep in sync with DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT in backend cart-merge.service.js.
export const DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT = 10;
export const DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS: SubscriptionFrequencyDays = 14;

export const SUBSCRIPTION_FREQUENCY_OPTIONS: ReadonlyArray<{ days: SubscriptionFrequencyDays; label: string }> = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Every month' }
];

export function isSubscriptionFrequency(value: unknown): value is SubscriptionFrequencyDays {
  return value === 7 || value === 14 || value === 30;
}

export function getSubscriptionFrequencyLabel(days: SubscriptionFrequencyDays | null | undefined): string {
  return SUBSCRIPTION_FREQUENCY_OPTIONS.find(option => option.days === days)?.label ?? '';
}

// Subscribe & Save is only offered for coffee & matcha flagged as subscribable.
export function isSubscriptionEligibleProduct(product: Partial<Product> | null | undefined): boolean {
  if (!product) return false;
  const flags = product as any;
  const enabled = flags.is_subscribable === true
    || flags.is_subscription === true
    || flags.is_subscribable === 'true'
    || flags.is_subscription === 'true';
  return (product.category === 'coffee' || product.category === 'matcha') && enabled;
}

export function getSubscribeDiscountPercent(product: Partial<Product> | null | undefined): number {
  return product?.subscribe_discount_percent ?? DEFAULT_SUBSCRIBE_DISCOUNT_PERCENT;
}

// Same rounding as the backend: price * (100 - discount) / 100, to the cent.
export function getSubscribePrice(originalPrice: number, discountPercent: number): number {
  return Math.round(originalPrice * (100 - discountPercent)) / 100;
}
