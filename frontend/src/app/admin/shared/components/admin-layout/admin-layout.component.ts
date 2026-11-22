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
  LucideListChecks,
  LucideCheckCheck,
  LucideTrash2,
  LucideCreditCard,
  LucideBoxes,
  LucideCalendarClock,
  LucideMail,
  LucideBanknote
} from '@lucide/angular';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminRefreshService } from '../../services/admin-refresh.service';
import {
  ADMIN_NOTIFICATION_TAB_LABELS,
  ADMIN_NOTIFICATION_VIEW_ALL,
  AdminNotification,
  AdminNotificationCategory,
  AdminNotificationService,
  AdminNotificationTab,
  AdminNotificationsResponse
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
    LucideListChecks,
    LucideCheckCheck,
    LucideTrash2,
    LucideCreditCard,
    LucideBoxes,
    LucideCalendarClock,
    LucideMail,
    LucideBanknote
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
  notificationCategories: AdminNotificationCategory[] = [];
  activeNotificationTab: AdminNotificationTab = 'all';
  unreadCount = 0;
  readonly notificationTabLabels = ADMIN_NOTIFICATION_TAB_LABELS;

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

  /** Every admin role has a bell; what each role receives is filtered on the server. */
  get canViewNotifications(): boolean {
    return !!this.adminAuth.getAdminRole();
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

    if (this.canViewNotifications) {
      this.notificationCategories = this.adminNotifications.fallbackCategories();

      interval(this.pollIntervalMs)
        .pipe(
          startWith(0),
          switchMap(() => this.adminNotifications.loadNotifications()),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((response) => this.applyNotifications(response));

      // Order actions (refund decided, status changed...) refresh the bell right away.
      this.adminRefresh.onNotificationsRefresh$
        .pipe(
          switchMap(() => this.adminNotifications.loadNotifications()),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((response) => this.applyNotifications(response));

      this.adminRefresh.onOrdersListRefresh$
        .pipe(
          switchMap(() => this.adminNotifications.loadNotifications()),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((response) => this.applyNotifications(response));
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

  private applyNotifications(response: AdminNotificationsResponse | null): void {
    this.notificationsLoading = false;
    if (response) {
      this.adminNotifications.pruneDeletedIds(response.data);
      this.notifications = this.adminNotifications.withoutDeleted(response.data);
      this.notificationCategories = response.categories;
      if (this.activeNotificationTab !== 'all' && !this.notificationCategories.includes(this.activeNotificationTab)) {
        this.activeNotificationTab = 'all';
      }
      this.adminNotifications.pruneReadIds(response.data);
    }
    this.unreadCount = this.adminNotifications.getUnreadCount(this.notifications);
    this.cdr.markForCheck();
  }

  // ── Notification tabs (same idea as the customer bell: ALL + one tab per area) ──

  get notificationTabs(): AdminNotificationTab[] {
    return ['all', ...this.notificationCategories];
  }

  /** Columns so every row is full: 6 tabs → 3 per row, 4 tabs → 2 per row. */

  get filteredNotifications(): AdminNotification[] {
    if (this.activeNotificationTab === 'all') return this.notifications;
    return this.notifications.filter((item) => item.category === this.activeNotificationTab);
  }

  get activeViewAll(): { label: string; link: string; query?: Record<string, string> } | null {
    return this.activeNotificationTab === 'all' ? null : ADMIN_NOTIFICATION_VIEW_ALL[this.activeNotificationTab];
  }

  setNotificationTab(tab: AdminNotificationTab, event: MouseEvent): void {
    event.stopPropagation();
    this.activeNotificationTab = tab;
    this.cdr.markForCheck();
  }

  tabUnreadCount(tab: AdminNotificationTab): number {
    const items = tab === 'all' ? this.notifications : this.notifications.filter((item) => item.category === tab);
    return this.adminNotifications.getUnreadCount(items);
  }

  isNotificationRead(item: AdminNotification): boolean {
    return this.adminNotifications.isRead(item);
  }

  markAllNotificationsRead(event: MouseEvent): void {
    event.stopPropagation();
    this.adminNotifications.markAllAsRead(this.filteredNotifications);
    this.unreadCount = this.adminNotifications.getUnreadCount(this.notifications);
    this.cdr.markForCheck();
  }

  deleteNotification(item: AdminNotification, event: Event): void {
    event.stopPropagation();
    this.adminNotifications.delete([item]);
    this.notifications = this.notifications.filter((row) => row.id !== item.id);
    this.unreadCount = this.adminNotifications.getUnreadCount(this.notifications);
    this.cdr.markForCheck();
  }

  /** Deletes every notice in the open tab (same scope as "Read all"). */
  deleteAllNotifications(event: MouseEvent): void {
    event.stopPropagation();
    const items = this.filteredNotifications;
    if (!items.length) return;
    this.adminNotifications.delete(items);
    const gone = new Set(items.map((item) => item.id));
    this.notifications = this.notifications.filter((row) => !gone.has(row.id));
    this.unreadCount = this.adminNotifications.getUnreadCount(this.notifications);
    this.cdr.markForCheck();
  }

  notificationCategoryLabel(item: AdminNotification): string {
    return ADMIN_NOTIFICATION_TAB_LABELS[item.category];
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
    // Orders opens on the last 30 days; a lookup from another page uses its widest range.
    const range = section.listPath === '/admin/orders' ? { date: '90' } : {};
    void this.router.navigate([section.listPath], { queryParams: { [section.param]: value, ...range } });
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
    this.cdr.markForCheck();

    // Show the cached list at once; refresh in the background.
    this.notificationsLoading = !this.notifications.length;
    this.adminNotifications.loadNotifications().subscribe((response) => this.applyNotifications(response));
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

  openNotification(item: AdminNotification, event: Event): void {
    event.stopPropagation();
    this.adminNotifications.markAsRead(item.id);
    this.unreadCount = this.adminNotifications.getUnreadCount(this.notifications);
    this.closeNotifications();
    void this.router.navigate([item.link], item.query ? { queryParams: item.query } : {});
  }

  viewAllNotifications(event: MouseEvent): void {
    event.stopPropagation();
    const target = this.activeViewAll;
    if (!target) return;
    this.closeNotifications();
    void this.router.navigate([target.link], target.query ? { queryParams: target.query } : {});
  }

  formatNotificationTime(value: string | null): string {
    if (!value) return '';
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
