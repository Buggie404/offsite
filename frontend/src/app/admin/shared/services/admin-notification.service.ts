import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { AdminAuthService } from '../../auth/services/admin-auth.service';
import { AdminRole } from '../../../shared/models/admin-role.model';

/**
 * Notice types sent by GET /api/admin/notifications. Which role receives which type is decided
 * on the server (NOTIFICATION_REGISTRY in admin-notifications.controller.js); ADMIN_NOTIFICATION_ROLES
 * below mirrors it for the UI only.
 */
export type AdminNotificationType =
  | 'refund_requested'
  | 'refund_payout'
  | 'processing_late'
  | 'ready_to_ship'
  | 'delivery_failed'
  | 'box_not_started'
  | 'box_payment_failed'
  | 'box_suspended'
  | 'box_out_of_stock'
  | 'stock_out'
  | 'stock_low'
  | 'expiry_missing'
  | 'report_pending'
  | 'recipe_resubmitted'
  | 'chat_waiting'
  | 'chat_needs_reply'
  | 'contact_new';

export type AdminNotificationCategory = 'orders' | 'ritual_box' | 'products' | 'community' | 'support';
export type AdminNotificationTab = 'all' | AdminNotificationCategory;
export type AdminNotificationTone = 'danger' | 'warning' | 'info' | 'neutral';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  category: AdminNotificationCategory;
  tone: AdminNotificationTone;
  overdue: boolean;
  title: string;
  message: string;
  /** null for ongoing states with no event time (e.g. stock levels) */
  created_at: string | null;
  link: string;
  query: Record<string, string> | null;
  mailto?: string;
}

export interface AdminNotificationsResponse {
  data: AdminNotification[];
  categories: AdminNotificationCategory[];
  counts: Partial<Record<AdminNotificationCategory, number>>;
  updated_at: string;
}

export const ADMIN_NOTIFICATION_TAB_LABELS: Record<AdminNotificationTab, string> = {
  all: 'All',
  orders: 'Orders',
  ritual_box: 'Ritual Box',
  products: 'Products',
  community: 'Community',
  support: 'Support'
};

/** Fallback tabs per role, used until the first response arrives (server sends `categories`). */
export const ADMIN_NOTIFICATION_CATEGORIES: Record<AdminRole, readonly AdminNotificationCategory[]> = {
  admin_cc: ['orders', 'ritual_box', 'products', 'community', 'support'],
  qlsp: ['orders', 'ritual_box', 'products'],
  cskh: ['orders', 'community', 'support']
};

/** "View all" target per tab. */
export const ADMIN_NOTIFICATION_VIEW_ALL: Record<AdminNotificationCategory, { label: string; link: string; query?: Record<string, string> }> = {
  orders: { label: 'Open orders that need attention', link: '/admin/orders', query: { attention: 'needs_attention', date: '90' } },
  ritual_box: { label: 'Open Ritual Boxes that need action', link: '/admin/subscriptions', query: { status: 'needs_action' } },
  products: { label: 'Open low-stock products', link: '/admin/products', query: { stock: 'low' } },
  community: { label: 'Open community reports', link: '/admin/community-reports' },
  support: { label: 'Open support chat', link: '/admin/chat' }
};

@Injectable({
  providedIn: 'root'
})
export class AdminNotificationService {
  private readonly http = inject(HttpClient);
  private readonly adminAuth = inject(AdminAuthService);
  private readonly apiUrl = '/api/admin/notifications';
  private readonly readStoragePrefix = 'admin_notifications_read';

  loadNotifications(): Observable<AdminNotificationsResponse | null> {
    return this.http.get<AdminNotificationsResponse>(this.apiUrl).pipe(
      map((response) => ({
        data: response?.data || [],
        categories: response?.categories || this.fallbackCategories(),
        counts: response?.counts || {},
        updated_at: response?.updated_at || new Date().toISOString()
      })),
      // Keep the last list on a failed poll (the caller ignores null).
      catchError(() => of(null))
    );
  }

  fallbackCategories(): AdminNotificationCategory[] {
    const role = this.adminAuth.getAdminRole();
    return role ? [...ADMIN_NOTIFICATION_CATEGORIES[role]] : [];
  }

  isRead(item: AdminNotification): boolean {
    return this.getReadIds().has(item.id);
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

  /** Forget read marks for notices that are gone, so storage doesn't grow forever. */
  pruneReadIds(notifications: AdminNotification[]): void {
    const current = new Set(notifications.map((item) => item.id));
    const readIds = this.getReadIds();
    const kept = new Set([...readIds].filter((id) => current.has(id)));
    if (kept.size !== readIds.size) this.persistReadIds(kept);
  }

  // ── Read state: localStorage, one key per admin account ──────────────────

  private get readStorageKey(): string {
    const user = this.adminAuth.getUser();
    return `${this.readStoragePrefix}:${user?.user_id || user?._id || 'anonymous'}`;
  }

  private getReadIds(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(this.readStorageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  private persistReadIds(readIds: Set<string>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.readStorageKey, JSON.stringify([...readIds]));
    } catch {
      // Ignore storage errors (quota, private mode).
    }
  }
}
