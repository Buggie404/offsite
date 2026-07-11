import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, catchError, of } from 'rxjs';
import { AdminOrderService } from './admin-order.service';
import { AdminOrderListItem } from '../models/admin-order.model';

export type AdminNotificationType =
  | 'refund_pending'
  | 'ready_to_ship'
  | 'urgent_processing';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  orderId: string;
  title: string;
  message: string;
  createdAt: string;
}

/** How many days a processing order must be open to trigger the urgent alert */
const URGENT_PROCESSING_DAYS = 3;

@Injectable({
  providedIn: 'root'
})
export class AdminNotificationService {
  private readonly adminOrderService = inject(AdminOrderService);
  private readonly readStorageKey = 'admin_notifications_read';

  /**
   * Key → value: ISO date string (YYYY-MM-DD) of when the urgent notification
   * was last shown for each orderId.  Stored in localStorage so it persists
   * across page reloads within the same calendar day.
   */
  private readonly urgentShownKey = 'admin_urgent_shown';

  loadNotifications(): Observable<AdminNotification[]> {
    return forkJoin({
      refunds: this.adminOrderService
        .getOrders({ order_status: 'pending_refund', date_range: '90', limit: 20 })
        .pipe(
          map((response) => response.data),
          catchError(() => of([] as AdminOrderListItem[]))
        ),
      processing: this.adminOrderService
        .getOrders({ order_status: 'processing', date_range: '90', limit: 50 })
        .pipe(
          map((response) => response.data),
          catchError(() => of([] as AdminOrderListItem[]))
        )
    }).pipe(
      map(({ refunds, processing }) => {
        const refundItems = refunds.map((order) =>
          this.toNotification(order, 'refund_pending')
        );

        // Ready-to-ship = all processing orders (existing behaviour)
        const shipItems = processing.map((order) =>
          this.toNotification(order, 'ready_to_ship')
        );

        // Urgent = processing orders that have been open ≥ URGENT_PROCESSING_DAYS
        const urgentItems = processing
          .filter((order) => this.isOrderOverdue(order))
          .map((order) => this.toNotification(order, 'urgent_processing'));

        return [...refundItems, ...shipItems, ...urgentItems].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      })
    );
  }

  getUnreadCount(notifications: AdminNotification[]): number {
    const readIds = this.getReadIds();
    return notifications.filter((item) => {
      if (item.type === 'urgent_processing') {
        return this.shouldShowUrgentToday(item.orderId) && !readIds.has(item.id);
      }
      return !readIds.has(item.id);
    }).length;
  }

  markAsRead(notificationId: string): void {
    const readIds = this.getReadIds();
    readIds.add(notificationId);
    this.persistReadIds(readIds);

    // If it's an urgent notification, record that we've shown it today
    if (notificationId.startsWith('urgent_processing:')) {
      const orderId = notificationId.replace('urgent_processing:', '');
      this.recordUrgentShown(orderId);
    }
  }

  markAllAsRead(notifications: AdminNotification[]): void {
    const readIds = this.getReadIds();
    notifications.forEach((item) => {
      readIds.add(item.id);
      if (item.type === 'urgent_processing') {
        this.recordUrgentShown(item.orderId);
      }
    });
    this.persistReadIds(readIds);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private toNotification(
    order: AdminOrderListItem,
    type: AdminNotificationType
  ): AdminNotification {
    if (type === 'refund_pending') {
      return {
        id: `refund_pending:${order.order_id}`,
        type,
        orderId: order.order_id,
        title: `Refund request · #${order.order_id}`,
        message: `${order.customer_name} requested a refund`,
        createdAt: order.created_at
      };
    }

    if (type === 'urgent_processing') {
      const days = this.daysSince(order.created_at);
      return {
        id: `urgent_processing:${order.order_id}`,
        type,
        orderId: order.order_id,
        title: `Order needs urgent preparation · #${order.order_id}`,
        message: `${order.customer_name} — processing for ${days} day${days !== 1 ? 's' : ''}`,
        createdAt: order.created_at
      };
    }

    // ready_to_ship
    return {
      id: `ready_to_ship:${order.order_id}`,
      type,
      orderId: order.order_id,
      title: `Ready to ship · #${order.order_id}`,
      message: `${order.customer_name} — mark as Shipping`,
      createdAt: order.created_at
    };
  }

  /** Returns true if the order has been in "processing" for ≥ URGENT_PROCESSING_DAYS. */
  private isOrderOverdue(order: AdminOrderListItem): boolean {
    return this.daysSince(order.created_at) >= URGENT_PROCESSING_DAYS;
  }

  /** Returns the number of whole calendar days since `isoDate`. */
  private daysSince(isoDate: string): number {
    const created = new Date(isoDate).getTime();
    if (Number.isNaN(created)) return 0;
    const now = Date.now();
    return Math.floor((now - created) / (1_000 * 60 * 60 * 24));
  }

  /**
   * Returns true if we haven't shown the urgent notification for this order today.
   * Uses today's YYYY-MM-DD string as the "shown" marker stored in localStorage.
   */
  private shouldShowUrgentToday(orderId: string): boolean {
    const shownMap = this.getUrgentShownMap();
    const today = this.todayString();
    return shownMap[orderId] !== today;
  }

  /** Record that we showed the urgent notification for this order today. */
  private recordUrgentShown(orderId: string): void {
    const shownMap = this.getUrgentShownMap();
    shownMap[orderId] = this.todayString();
    this.persistUrgentShownMap(shownMap);
  }

  private todayString(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private getUrgentShownMap(): Record<string, string> {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(this.urgentShownKey);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private persistUrgentShownMap(map: Record<string, string>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.urgentShownKey, JSON.stringify(map));
    } catch {
      // Ignore storage errors
    }
  }

  // ── Read-state helpers (sessionStorage) ───────────────────────────────────

  private getReadIds(): Set<string> {
    if (typeof sessionStorage === 'undefined') {
      return new Set();
    }

    try {
      const raw = sessionStorage.getItem(this.readStorageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  private persistReadIds(readIds: Set<string>): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    sessionStorage.setItem(this.readStorageKey, JSON.stringify([...readIds]));
  }
}
