import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, catchError, of } from 'rxjs';
import { AdminOrderService } from './admin-order.service';
import { AdminOrderListItem } from '../models/admin-order.model';

export type AdminNotificationType = 'refund_pending' | 'ready_to_ship';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  orderId: string;
  title: string;
  message: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminNotificationService {
  private readonly adminOrderService = inject(AdminOrderService);
  private readonly readStorageKey = 'admin_notifications_read';

  loadNotifications(): Observable<AdminNotification[]> {
    return forkJoin({
      refunds: this.adminOrderService
        .getOrders({ order_status: 'pending_refund', date_range: '90', limit: 20 })
        .pipe(
          map((response) => response.data),
          catchError(() => of([] as AdminOrderListItem[]))
        ),
      shipping: this.adminOrderService
        .getOrders({ order_status: 'processing', date_range: '90', limit: 20 })
        .pipe(
          map((response) => response.data),
          catchError(() => of([] as AdminOrderListItem[]))
        )
    }).pipe(
      map(({ refunds, shipping }) => {
        const refundItems = refunds.map((order) => this.toNotification(order, 'refund_pending'));
        const shipItems = shipping.map((order) => this.toNotification(order, 'ready_to_ship'));
        return [...refundItems, ...shipItems].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      })
    );
  }

  getUnreadCount(notifications: AdminNotification[]): number {
    const readIds = this.getReadIds();
    return notifications.filter((item) => !readIds.has(item.id)).length;
  }

  markAsRead(notificationId: string): void {
    const readIds = this.getReadIds();
    readIds.add(notificationId);
    this.persistReadIds(readIds);
  }

  markAllAsRead(notifications: AdminNotification[]): void {
    const readIds = this.getReadIds();
    notifications.forEach((item) => readIds.add(item.id));
    this.persistReadIds(readIds);
  }

  private toNotification(order: AdminOrderListItem, type: AdminNotificationType): AdminNotification {
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

    return {
      id: `ready_to_ship:${order.order_id}`,
      type,
      orderId: order.order_id,
      title: `Ready to ship · #${order.order_id}`,
      message: `${order.customer_name} — mark as Shipping`,
      createdAt: order.created_at
    };
  }

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
