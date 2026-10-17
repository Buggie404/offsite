export type OrderType = 'one_time' | 'subscription' | 'mixed';

interface OrderLike {
  subscription_id?: string | null;
  items?: Array<{ purchase_type?: string | null }>;
}

/**
 * One-time / Subscription / Mixed, from the purchase type of each line.
 * Orders billed by the Ritual Box charge job (subscription_id set) are Subscription.
 */
export function getOrderType(order: OrderLike | null | undefined): OrderType {
  if (order?.subscription_id) return 'subscription';
  const items = order?.items ?? [];
  const subs = items.filter(it => it.purchase_type === 'subscription').length;
  if (subs === 0) return 'one_time';
  return subs === items.length ? 'subscription' : 'mixed';
}

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  one_time: 'One-time',
  subscription: 'Subscription',
  mixed: 'Mixed'
};

const FREQUENCY_LABEL: Record<number, string> = { 7: 'Every week', 14: 'Every 2 weeks', 30: 'Every month' };

export function getFrequencyLabel(days: number | null | undefined): string {
  return (days && FREQUENCY_LABEL[days]) || (days ? `Every ${days} days` : '');
}

/** "Ritual Box · Every 2 weeks" for a subscription order line, '' otherwise. */
export function getSubscriptionLineLabel(item: { purchase_type?: string | null; subscription_frequency_days?: number | null }): string {
  if (item?.purchase_type !== 'subscription') return '';
  const freq = getFrequencyLabel(item.subscription_frequency_days);
  return freq ? `Ritual Box · ${freq}` : 'Ritual Box';
}

const CLOSED_SUBSCRIPTION_STATUSES = ['cancelled', 'cancelled_by_admin'];

/** Ritual Boxes from this order that are still running (cancelled ones drop out). */
export function getOpenSubscriptions<T extends { status?: string }>(subscriptions: T[] | null | undefined): T[] {
  return (subscriptions ?? []).filter(sub => !CLOSED_SUBSCRIPTION_STATUSES.includes(sub.status ?? ''));
}

/** "Then every 2 weeks · $28.80" rows from the Ritual Boxes this order started that are still running. */
export function getRecurringRows(subscriptions: Array<{ frequency_days: number; price_per_delivery: number; status?: string }> | null | undefined) {
  const groups = new Map<number, number>();
  for (const sub of getOpenSubscriptions(subscriptions)) {
    groups.set(sub.frequency_days, (groups.get(sub.frequency_days) ?? 0) + sub.price_per_delivery);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([days, amount]) => ({ label: getFrequencyLabel(days).toLowerCase(), amount: Math.round(amount * 100) / 100 }));
}
