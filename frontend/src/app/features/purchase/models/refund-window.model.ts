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
