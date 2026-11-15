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
  LucideStar,
  LucideListChecks
} from '@lucide/angular';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminRefreshService } from '../../services/admin-refresh.service';
import {
  AdminNotification,
  AdminNotificationService
} from '../../services/admin-notification.service';
import { ADMIN_NAV_GROUPS, AdminNavGroup, AdminNavItem } from '../../../admin-navigation.config';
import { ADMIN_ROLE_LABELS } from '../../../../shared/models/admin-role.model';
import { AdminRecipeService } from '../../../recipes/services/admin-recipe.service';

export interface HeaderSearchSection {
  placeholder: string;
  /** List page the search filters. */
  listPath: string;
  /** Query parameter that list page reads. */
  param: 'search' | 'q';
}

const ORDER_LOOKUP: HeaderSearchSection = { placeholder: 'Find an order by ID, customer name or email…', listPath: '/admin/orders', param: 'search' };

// First match wins; prefixes cover the list and its detail pages.
const HEADER_SEARCH: { prefix: string; section: HeaderSearchSection | null }[] = [
  { prefix: '/admin/orders', section: { placeholder: 'Search by order ID, customer name or email…', listPath: '/admin/orders', param: 'search' } },
  { prefix: '/admin/service-customers', section: { placeholder: 'Search customers by name, email or ID…', listPath: '/admin/service-customers', param: 'q' } },
  { prefix: '/admin/customers', section: { placeholder: 'Search customers by name, email or ID…', listPath: '/admin/customers', param: 'q' } },
  { prefix: '/admin/products/', section: null },
  { prefix: '/admin/products', section: { placeholder: 'Search products by name or SKU…', listPath: '/admin/products', param: 'search' } },
  { prefix: '/admin/vouchers', section: { placeholder: 'Search vouchers by code…', listPath: '/admin/vouchers', param: 'search' } },
  { prefix: '/admin/subscriptions', section: { placeholder: 'Search subscriptions by ID, customer or product…', listPath: '/admin/subscriptions', param: 'search' } },
  { prefix: '/admin/ritual-dna', section: { placeholder: 'Search DNA customers by name, email or ID…', listPath: '/admin/ritual-dna', param: 'search' } },
  { prefix: '/admin/chat', section: { placeholder: 'Search conversations by name or customer ID…', listPath: '/admin/chat', param: 'search' } },
  { prefix: '/admin/recipes', section: { placeholder: 'Search recipes by title or author…', listPath: '/admin/recipes', param: 'search' } },
  { prefix: '/admin/community-reports', section: { placeholder: 'Search reports by user, content or reason…', listPath: '/admin/community-reports', param: 'search' } },
  { prefix: '/admin/staff', section: { placeholder: 'Search staff by name, email or ID…', listPath: '/admin/staff', param: 'search' } },
  { prefix: '/admin/activity-log', section: { placeholder: 'Search name, target, ID or reason…', listPath: '/admin/activity-log', param: 'search' } },
  { prefix: '/admin/starter-quiz', section: null }
];

export function headerSearchFor(path: string): HeaderSearchSection | null {
  const hit = HEADER_SEARCH.find((entry) => path === entry.prefix || path.startsWith(entry.prefix.endsWith('/') ? entry.prefix : entry.prefix + '/'));
  // Dashboards and anything else: quick order lookup (Enter opens Orders).
  return hit ? hit.section : ORDER_LOOKUP;
}

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
    LucideStar,
    LucideListChecks
  ],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent implements OnInit, AfterViewInit {
  private adminAuth = inject(AdminAuthService);
  private adminRefresh = inject(AdminRefreshService);
  private adminNotifications = inject(AdminNotificationService);
  private recipesApi = inject(AdminRecipeService);
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
    return this.adminAuth.getDisplayName();
  }

  get adminInitials(): string {
    return this.adminAuth.getInitials();
  }

  get adminRoleLabel(): string {
    const role = this.adminAuth.getAdminRole();
    return role ? ADMIN_ROLE_LABELS[role] : 'Unassigned role';
  }

  get adminHomeRoute(): string {
    return this.adminAuth.getDefaultRoute();
  }

  /** Header search target for the current page (one search bar per section; pages have no search of their own). */
  get searchSection(): HeaderSearchSection | null {
    return headerSearchFor(this.router.url.split('?')[0]);
  }

  get searchPlaceholder(): string {
    return this.searchSection?.placeholder || '';
  }

  get showHeaderSearch(): boolean {
    return !!this.searchSection;
  }

  get searchAriaLabel(): string {
    return this.searchPlaceholder.replace(/(\.\.\.|…)$/, '');
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
        this.syncSearchFromUrl();
      });

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.syncSearchFromUrl());

    this.warmRecipesPage();

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

  private warmRecipesPage(): void {
    const canOpenRecipes = this.visibleNavigationGroups.some((group) =>
      group.items.some((item) => item.path === '/admin/recipes')
    );
    if (!canOpenRecipes) return;
    this.recipesApi.prefetch();
    void import('../../../recipes/pages/recipes/recipes.component');
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

  /** On a list page the box mirrors its parameter; elsewhere it starts empty. */
  private syncSearchFromUrl(): void {
    const section = this.searchSection;
    const params = this.router.parseUrl(this.router.url).queryParams;
    this.searchQuery = section && this.isOnSearchList(section) ? (params[section.param] || '') : '';
    this.cdr.markForCheck();
  }

  private isOnSearchList(section: HeaderSearchSection): boolean {
    return this.router.url.split('?')[0] === section.listPath;
  }

  /** On the section's list page, every keystroke filters it. Elsewhere (details, dashboards) Enter opens the list. */
  onSearchInput(value: string): void {
    this.searchQuery = value;
    const section = this.searchSection;
    if (!section || !this.isOnSearchList(section)) return;
    const extra = section.listPath === '/admin/products' ? { page: null, scroll: null }
      : section.param === 'q' ? { page: null, search: null } : {};
    void this.router.navigate([section.listPath], {
      queryParams: { [section.param]: value || null, ...extra },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  onSearchEnter(): void {
    const section = this.searchSection;
    const value = this.searchQuery.trim();
    if (!section || this.isOnSearchList(section) || !value) return;
    void this.router.navigate([section.listPath], { queryParams: { [section.param]: value } });
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
    this.showAdminUserMenu = false;

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
    if (!this.showAdminUserMenu) this.closeNotifications();
    this.showAdminUserMenu = !this.showAdminUserMenu;
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
