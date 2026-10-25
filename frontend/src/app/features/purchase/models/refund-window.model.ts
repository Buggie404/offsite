// Mirrors backend points.service REFUND_WINDOW_DAYS: refund/return can be requested
// for at most 3 days after the order is delivered.
export const REFUND_WINDOW_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function getDeliveredAt(order: any): Date | null {
  const raw = order?.delivered_at
    || [...(order?.status_history || [])].reverse().find((h: any) => h.status === 'delivered')?.changed_at;
  return raw ? new Date(raw) : null;
}

export function getRefundDeadline(order: any): Date | null {
  const deliveredAt = getDeliveredAt(order);
  return deliveredAt ? new Date(deliveredAt.getTime() + REFUND_WINDOW_DAYS * DAY_MS) : null;
}

export function isWithinRefundWindow(order: any, now: number = Date.now()): boolean {
  const deadline = getRefundDeadline(order);
  return !deadline || now <= deadline.getTime();
}

/**
 * Shown once the order is delivered so customers know the return deadline up
 * front, not only when the button disappears.
 */
export function getRefundWindowNote(order: any): string | null {
  if (!order) return null;
  const status = (order.order_status || '').toLowerCase();
  if (status !== 'delivered' && status !== 'refund_rejected') return null;
  if (order.refund_request?.status === 'pending') return null;
  const deadline = getRefundDeadline(order);
  if (!deadline) return null;
  const date = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return isWithinRefundWindow(order)
    ? `Returns and refunds accepted until ${date}.`
    : `The return window closed on ${date}.`;
}
