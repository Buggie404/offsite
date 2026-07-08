import { AfterViewInit, ChangeDetectorRef, Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, interval, startWith, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucidePackage,
  LucideLogOut,
  LucideSearch,
  LucideBell,
  LucideX,
  LucideTruck,
  LucideUndo2
} from '@lucide/angular';
import { AdminAuthService } from '../../services/admin-auth.service';
import { AdminRefreshService } from '../../services/admin-refresh.service';
import {
  AdminNotification,
  AdminNotificationService
} from '../../services/admin-notification.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    LucidePackage,
    LucideLogOut,
    LucideSearch,
    LucideBell,
    LucideX,
    LucideTruck,
    LucideUndo2
  ],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent implements OnInit, AfterViewInit {
  private adminAuth = inject(AdminAuthService);
  private adminRefresh = inject(AdminRefreshService);
  private adminNotifications = inject(AdminNotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('notificationsRoot') notificationsRoot?: ElementRef<HTMLElement>;

  searchQuery = '';
  ordersLinkActive = false;
  showSignOutModal = false;
  showNotifications = false;
  notificationsLoading = false;
  notifications: AdminNotification[] = [];
  unreadCount = 0;

  private readonly pollIntervalMs = 30_000;

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.showNotifications) {
      this.closeNotifications();
      return;
    }

    if (this.showSignOutModal) {
      this.closeSignOutModal();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showNotifications) return;

    const root = this.notificationsRoot?.nativeElement;
    if (root && !root.contains(event.target as Node)) {
      this.closeNotifications();
    }
  }

  ngOnInit(): void {
    this.updateOrdersLinkActive();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.updateOrdersLinkActive();
        this.closeNotifications();
      });

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.searchQuery = params['search'] || '';
    });

    interval(this.pollIntervalMs)
      .pipe(
        startWith(0),
        switchMap(() => this.adminNotifications.loadNotifications()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((items) => this.applyNotifications(items, false));

    this.adminRefresh.onNotificationsRefresh$
      .pipe(
        switchMap(() => this.adminNotifications.loadNotifications()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((items) => this.applyNotifications(items, false));

    this.adminRefresh.onOrdersListRefresh$
      .pipe(
        switchMap(() => this.adminNotifications.loadNotifications()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((items) => this.applyNotifications(items, false));
  }

  ngAfterViewInit(): void {
    this.ensureChildRoute();
  }

  private ensureChildRoute(): void {
    if (this.route.firstChild) return;

    const url = this.router.url.split('?')[0];
    const adminPath = url.replace(/^\/admin\/?/, '') || 'orders';

    void this.router.navigate([adminPath], { relativeTo: this.route, replaceUrl: true });
  }

  private updateOrdersLinkActive(): void {
    const url = this.router.url.split('?')[0];
    this.ordersLinkActive = url === '/admin/orders' || url.startsWith('/admin/orders/');
  }

  private applyNotifications(items: AdminNotification[], markRead: boolean): void {
    this.notifications = items;
    if (markRead) {
      this.adminNotifications.markAllAsRead(items);
    }
    this.unreadCount = this.adminNotifications.getUnreadCount(items);
    this.notificationsLoading = false;
    this.cdr.markForCheck();
  }

  get avatarInitials(): string {
    const user = this.adminAuth.getUser();
    const source = user?.profile_name || user?.email || 'AD';
    const parts = source.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }

  get hasRefundNotifications(): boolean {
    return this.notifications.some((item) => item.type === 'refund_pending');
  }

  get hasShipNotifications(): boolean {
    return this.notifications.some((item) => item.type === 'ready_to_ship');
  }

  onSearchInput(value: string): void {
    this.searchQuery = value;
    this.router.navigate(['/admin/orders'], {
      queryParams: { search: value || null },
      queryParamsHandling: 'merge'
    });
  }

  onOrdersLinkClick(event: MouseEvent): void {
    const path = this.router.url.split('?')[0];
    if (path === '/admin/orders') {
      event.preventDefault();
      this.adminRefresh.refreshOrdersList();
    }
  }

  toggleNotifications(event: MouseEvent): void {
    event.stopPropagation();

    if (this.showNotifications) {
      this.closeNotifications();
      return;
    }

    this.showNotifications = true;
    this.notificationsLoading = true;
    this.cdr.markForCheck();

    this.adminNotifications.loadNotifications().subscribe({
      next: (items) => this.applyNotifications(items, true),
      error: () => {
        this.notificationsLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  closeNotifications(): void {
    this.showNotifications = false;
    this.cdr.markForCheck();
  }

  openNotification(item: AdminNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.adminNotifications.markAsRead(item.id);
    this.unreadCount = this.adminNotifications.getUnreadCount(this.notifications);
    this.closeNotifications();
    void this.router.navigate(['/admin/orders', item.orderId]);
  }

  viewAllRefunds(event: MouseEvent): void {
    event.stopPropagation();
    this.closeNotifications();
    void this.router.navigate(['/admin/orders'], { queryParams: { status: 'pending_refund' } });
  }

  viewAllToShip(event: MouseEvent): void {
    event.stopPropagation();
    this.closeNotifications();
    void this.router.navigate(['/admin/orders'], { queryParams: { status: 'processing' } });
  }

  formatNotificationTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  openSignOutModal(): void {
    this.closeNotifications();
    this.showSignOutModal = true;
  }

  closeSignOutModal(): void {
    this.showSignOutModal = false;
  }

  confirmSignOut(): void {
    this.showSignOutModal = false;
    this.adminAuth.logout();
    this.router.navigate(['/admin/login']);
  }
}
