import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, interval, startWith, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucidePackage,
  LucideLogOut,
  LucideSearch,
  LucideBell,
  LucideX,
  LucideTruck,
  LucideUndo2,
  LucideMenu,
  LucideAlertTriangle,
  LucideArrowRight,
  LucideLayoutDashboard,
  LucideTag,
  LucideUsers,
  LucideTicket,
  LucideRepeat,
  LucideMessageCircle,
  LucideFlag,
  LucideChefHat,
  LucideShield,
  LucideClipboardList,
  LucideActivity,
  LucideChevronDown,
  LucideStar
} from '@lucide/angular';
import { AdminAuthService } from '../../services/admin-auth.service';
import { AdminRefreshService } from '../../services/admin-refresh.service';
import {
  AdminNotification,
  AdminNotificationService
} from '../../services/admin-notification.service';
import { ADMIN_NAV_GROUPS, AdminNavGroup, AdminNavItem } from '../../admin-navigation.config';
import { ADMIN_ROLE_LABELS } from '../../../shared/models/admin-role.model';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucidePackage,
    LucideLogOut,
    LucideSearch,
    LucideBell,
    LucideX,
    LucideTruck,
    LucideUndo2,
    LucideMenu,
    LucideAlertTriangle,
    LucideArrowRight,
    LucideLayoutDashboard,
    LucideTag,
    LucideUsers,
    LucideTicket,
    LucideRepeat,
    LucideMessageCircle,
    LucideFlag,
    LucideChefHat,
    LucideShield,
    LucideClipboardList,
    LucideActivity,
    LucideChevronDown,
    LucideStar
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
  @ViewChild('adminUserRoot') adminUserRoot?: ElementRef<HTMLElement>;

  searchQuery = '';
  showSignOutModal = false;
  showNotifications = false;
  showAdminUserMenu = false;
  notificationsLoading = false;
  notifications: AdminNotification[] = [];
  unreadCount = 0;

  /** Whether the mobile/tablet slide-in sidebar is visible */
  sidebarOpen = false;

  private readonly pollIntervalMs = 30_000;

  get visibleNavigationGroups(): AdminNavGroup[] {
    const role = this.adminAuth.getAdminRole();
    if (!role) return [];

    return ADMIN_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => (item.visibleRoles || item.roles).includes(role))
    })).filter((group) => group.items.length > 0);
  }

  get adminDisplayName(): string {
    const user = this.adminAuth.getUser();
    return user?.profile_name?.trim() || user?.email || 'Admin';
  }

  get adminInitials(): string {
    const parts = this.adminDisplayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return this.adminDisplayName.slice(0, 2).toUpperCase();
  }

  get adminRoleLabel(): string {
    const role = this.adminAuth.getAdminRole();
    return role ? ADMIN_ROLE_LABELS[role] : 'Unassigned role';
  }

  get adminHomeRoute(): string {
    return this.adminAuth.getDefaultRoute();
  }

  get searchPlaceholder(): string {
    const path = this.router.url.split('?')[0];
    if (path.startsWith('/admin/chat')) return 'Search conversations...';
    if (path.startsWith('/admin/customers')) return 'Search customers...';
    if (path.startsWith('/admin/subscriptions')) return 'Search subscriptions...';
    if (path.startsWith('/admin/products')) return 'Search name or SKU...';
    return 'Search by order ID, customer name, or email...';
  }

  get searchAriaLabel(): string {
    return this.searchPlaceholder.replace(/\.\.\.$/, '');
  }

  get canViewOrderNotifications(): boolean {
    const role = this.adminAuth.getAdminRole();
    return role === 'admin_cc' || role === 'cskh' || role === 'qlsp';
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.sidebarOpen) {
      this.closeSidebar();
      return;
    }

    if (this.showNotifications) {
      this.closeNotifications();
      return;
    }

    if (this.showAdminUserMenu) {
      this.showAdminUserMenu = false;
      this.cdr.markForCheck();
      return;
    }

    if (this.showSignOutModal) {
      this.closeSignOutModal();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    const notificationsRoot = this.notificationsRoot?.nativeElement;
    if (this.showNotifications && notificationsRoot && !notificationsRoot.contains(target)) {
      this.closeNotifications();
    }

    const adminUserRoot = this.adminUserRoot?.nativeElement;
    if (this.showAdminUserMenu && adminUserRoot && !adminUserRoot.contains(target)) {
      this.showAdminUserMenu = false;
      this.cdr.markForCheck();
    }
  }

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.closeNotifications();
        this.closeSidebar();
      });

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.searchQuery = params['search'] || '';
    });

    if (this.canViewOrderNotifications) {
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
  }

  ngAfterViewInit(): void {
    this.ensureChildRoute();
  }

  private ensureChildRoute(): void {
    if (this.route.firstChild) return;
    void this.router.navigateByUrl(this.adminAuth.getDefaultRoute(), { replaceUrl: true });
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

  get hasRefundNotifications(): boolean {
    return this.notifications.some((item) => item.type === 'refund_pending');
  }

  get hasShipNotifications(): boolean {
    return this.notifications.some((item) => item.type === 'ready_to_ship');
  }

  get hasUrgentNotifications(): boolean {
    return this.notifications.some((item) => item.type === 'urgent_processing');
  }

  /** Notifications filtered by type — used by the sectioned panel UI */
  get refundNotifications(): AdminNotification[] {
    return this.notifications.filter((item) => item.type === 'refund_pending');
  }

  get shipNotifications(): AdminNotification[] {
    return this.notifications.filter((item) => item.type === 'ready_to_ship');
  }

  get urgentNotifications(): AdminNotification[] {
    return this.notifications.filter((item) => item.type === 'urgent_processing');
  }

  onSearchInput(value: string): void {
    this.searchQuery = value;
    const currentPath = this.router.url.split('?')[0];
    this.router.navigate([currentPath], {
      queryParams: { search: value || null },
      queryParamsHandling: 'merge'
    });
  }

  onNavigationClick(event: MouseEvent, item: AdminNavItem): void {
    const path = this.router.url.split('?')[0];
    if (item.path === '/admin/orders' && path === '/admin/orders') {
      event.preventDefault();
      this.adminRefresh.refreshOrdersList();
    }
    this.closeSidebar();
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────

  openSidebar(): void {
    this.sidebarOpen = true;
    this.cdr.markForCheck();
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
    this.cdr.markForCheck();
  }

  // ── Notifications ─────────────────────────────────────────────────────────

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

  toggleAdminUserMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.showAdminUserMenu = !this.showAdminUserMenu;
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

  viewAllUrgent(event: MouseEvent): void {
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

  // ── Sign-out modal ────────────────────────────────────────────────────────

  openSignOutModal(): void {
    this.closeNotifications();
    this.showAdminUserMenu = false;
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
