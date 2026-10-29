import { avatarInitials } from '../../utils/avatar';
import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, HostListener, ElementRef, ViewChild, signal, effect, untracked, ChangeDetectorRef } from '@angular/core';
import { SuccessModalComponent, SuccessModalConfig } from '../success-modal/success-modal.components';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import {
  LucideSearch,
  LucideShoppingCart,
  LucideShoppingBag,
  LucideUser,
  LucideX,
  LucideMenu,
  LucideLogIn,
  LucideLogOut,
  LucideClipboardClock,
  LucideChevronDown,
  LucideTrash2,
  LucidePlus,
  LucideMinus,
  LucideBookOpen,
  LucidePackage,
  LucideChefHat,
  LucideArrowRight,
  LucideBell,
  LucideCheckCheck,
  LucideSparkle,
  LucideLayoutGrid,
  LucideTruck,
  LucideHeart,
  LucideMessageSquare,
  LucideRefreshCw,
  LucideRepeat,
  LucideInfo,
  LucideHourglass
} from '@lucide/angular';
import { AuthService } from '../../../core/auth.service';
import { AuthModalService } from '../../../core/auth-modal.service';
import { AuthPromptModalService } from '../auth-prompt-modal/auth-prompt-modal.service';
import {
  CartService,
  CartItem,
  getCartItemChargedUnitPrice,
  getCartItemRecurringUnitPrice,
  getCartItemOriginalUnitPrice,
  getPurchaseType,
  isSubscriptionItem
} from '../../../features/purchase/services/cart.service';
import {
  PurchaseType,
  SUBSCRIPTION_FREQUENCY_OPTIONS,
  SubscriptionFrequencyDays,
  getSubscribeDiscountPercent,
  getSubscriptionFrequencyLabel,
  isSubscriptionEligibleProduct
} from '../../../features/purchase/models/subscription-cart.model';
import { ProductService } from '../../../features/home/services/product.service';
import { RecipeService } from '../../../features/home/services/recipe.service';
import { ContentService } from '../../../features/content/services/content.service';
import { CommunityService } from '../../../features/community/services/community.service';
import { Notification } from '../../../features/community/models/notification.model';
import { Product, getProductDetailSlug } from '../../../features/home/models/product.model';
import { Recipe } from '../../../features/home/models/recipe.model';
import { FormsModule } from '@angular/forms';
import {
  BundleComponentSelection,
  bundleComponentHasVariantOptions,
  getBundleComponentDisplayName,
  getBundleComponentImage,
  getBundleComponentInStockVariants,
  getBundleComponentLineQuantity,
  getBundleComponentTrackKey,
  getBundleContentComponents,
  getBundleContentToggleLabel,
  getBundleSaleLineTotal,
  getCartItemImage,
  getCartItemLineTotal,
  isBundleCartItem
} from '../../../features/purchase/models/bundle-cart.model';
import { isMeaningfulVariantLabel } from '../../utils/variant-label';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    LucideSearch,
    LucideShoppingCart,
    LucideShoppingBag,
    LucideUser,
    LucideX,
    LucideMenu,
    LucideLogIn,
    LucideLogOut,
    LucideClipboardClock,
    LucideChevronDown,
    SuccessModalComponent,
    LucideTrash2,
    LucidePlus,
    LucideMinus,
    LucideBookOpen,
    LucidePackage,
    LucideChefHat,
    LucideArrowRight,
    LucideBell,
    LucideCheckCheck,
    LucideSparkle,
    LucideLayoutGrid,
    LucideTruck,
    LucideHeart,
    LucideMessageSquare,
    LucideRefreshCw,
    LucideRepeat,
    LucideInfo,
    LucideHourglass,
    FormsModule
  ],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent implements OnInit, OnDestroy {
  /** Hide empty / "Default" variant labels (products without real variants). */
  readonly isMeaningfulVariantLabel = isMeaningfulVariantLabel;

  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private authPromptService = inject(AuthPromptModalService);
  private elementRef = inject(ElementRef);
  private router = inject(Router);
  private cartService = inject(CartService);
  private productService = inject(ProductService);
  private recipeService = inject(RecipeService);
  private contentService = inject(ContentService);
  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);

  notifications = signal<Notification[]>([]);
  unreadNotificationCount = 0;
  isNotificationDropdownOpen = signal<boolean>(false);
  activeNotificationTab = signal<string>('ALL');
  private notificationInterval: any;

  constructor() {
    effect(() => {
      if (!this.awaitingSubscriptionPrompt() || this.authPromptService.isOpen()) return;
      untracked(() => {
        this.awaitingSubscriptionPrompt.set(false);
        // LOG IN closes the prompt and opens the login modal; anything else means "not now".
        if (!this.authModalService.isOpen()) {
          this.switchSubscriptionsToOneTime();
        }
      });
    });

    effect(() => {
      if (this.isLoggedIn()) {
        this.authService.fetchUserProfile();
        this.loadNotifications();
        this.startNotificationPolling();
      } else {
        this.stopNotificationPolling();
        this.notifications.set([]);
        this.unreadNotificationCount = 0;
      }
    });
  }

  isPromobarVisible = true;
  isMobileMenuOpen = false;
  isProfileDropdownOpen = signal<boolean>(false);
  private profileDropdownTimeout: any = null;
  private notificationDropdownTimeout: any = null;
  isMobileProductsOpen = false;
  isMobileAboutOpen = false;
  isSearchOpen = false;
  isAboutDropdownOpen = false;
  isProductsMegaOpen = false;
  isSignOutModalOpen = false;

  searchQuery = '';
  hasSearched = false;
  searchFilter: 'ALL' | 'PRODUCTS' | 'JOURNAL' | 'RECIPES' = 'ALL';
  isLoadingResults = false;

  allProducts: Product[] = [];
  allRecipes: Recipe[] = [];
  allBlogs: any[] = [];

  filteredProducts: Product[] = [];
  filteredRecipes: Recipe[] = [];
  filteredBlogs: any[] = [];

  showSuccessModal = false;
  successModalConfig: SuccessModalConfig = {
    title: '',
    subtitle: '',
    primaryBtn: '',
  };

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  expandedKitKeys = new Set<string>();

  // Read-only signal from auth service
  isLoggedIn = this.authService.isAuthenticated;
  private awaitingSubscriptionPrompt = signal(false);

  cartItemErrors = signal<Record<string, string>>({});

  getCartItemError(item: CartItem): string | null {
    const key = this.getItemKey(item);
    return this.cartItemErrors()[key] || null;
  }

  isCheckoutDisabled(): boolean {
    if (!this.hasSelectedItems) return true;
    return this.cartItems.some(item => {
      if (!item.selected || this.isItemOutOfStock(item)) return false;
      return !!this.cartItemErrors()[this.getItemKey(item)];
    });
  }

  onQtyKeydown(event: KeyboardEvent): void {
    const allowedKeys = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'
    ];
    if (allowedKeys.includes(event.key) || (event.ctrlKey || event.metaKey)) {
      return;
    }
    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  }

  onQtyInput(event: Event, item: CartItem): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/[^0-9]/g, '');
    input.value = value;

    const qty = value ? parseInt(value, 10) : 0;
    const variant = this.getVariant(item);
    const stock = variant ? variant.stock : 0;
    const key = this.getItemKey(item);

    if (qty <= 0 || value === '') {
      this.cartItemErrors.update(errors => ({
        ...errors,
        [key]: 'Quantity must be at least 1'
      }));
    } else if (qty > stock) {
      this.cartItemErrors.update(errors => ({
        ...errors,
        [key]: `Only ${stock} items left in stock`
      }));
    } else {
      this.cartItemErrors.update(errors => {
        const copy = { ...errors };
        delete copy[key];
        return copy;
      });
      this.cartService.updateQuantity(this.getProductIdentifier(item), item.variantSku, qty, getPurchaseType(item));
    }
  }

  onQtyBlur(item: CartItem, event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/[^0-9]/g, '');
    let qty = value ? parseInt(value, 10) : 0;
    const variant = this.getVariant(item);
    const stock = variant ? variant.stock : 0;
    const key = this.getItemKey(item);

    if (qty <= 0 || value === '') {
      qty = 1;
    } else if (qty > stock) {
      qty = stock;
    }

    this.cartItemErrors.update(errors => {
      const copy = { ...errors };
      delete copy[key];
      return copy;
    });

    this.cartService.updateQuantity(this.getProductIdentifier(item), item.variantSku, qty, getPurchaseType(item));
    input.value = String(qty);
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('promobar-closed');
      const closed = sessionStorage.getItem('promobar-closed');
      if (closed === 'true') {
        this.isPromobarVisible = false;
      }
    }

    // Close all dropdowns when route changes
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.isProfileDropdownOpen.set(false);
      this.isNotificationDropdownOpen.set(false);
      this.isMobileMenuOpen = false;
      this.isMobileProductsOpen = false;
      this.isMobileAboutOpen = false;
      this.isAboutDropdownOpen = false;
      this.isProductsMegaOpen = false;
    });
  }

  closePromobar(): void {
    this.isPromobarVisible = false;
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.setItem('promobar-closed', 'true');
    }
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
    if (!this.isMobileMenuOpen) {
      this.isMobileProductsOpen = false;
      this.isMobileAboutOpen = false;
    }
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
    this.isMobileProductsOpen = false;
    this.isMobileAboutOpen = false;
  }

  toggleMobileProducts(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.isMobileProductsOpen = !this.isMobileProductsOpen;
  }

  toggleMobileAbout(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.isMobileAboutOpen = !this.isMobileAboutOpen;
  }

  toggleProductsMega(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.isProductsMegaOpen = !this.isProductsMegaOpen;
  }

  openProfileDropdown(): void {
    this.closeNotificationDropdown(0);
    this.isProductsMegaOpen = false;
    if (this.profileDropdownTimeout) {
      clearTimeout(this.profileDropdownTimeout);
      this.profileDropdownTimeout = null;
    }
    this.isProfileDropdownOpen.set(true);
    this.cdr.markForCheck();
  }

  closeProfileDropdown(delay: number = 80): void {
    if (this.profileDropdownTimeout) {
      clearTimeout(this.profileDropdownTimeout);
      this.profileDropdownTimeout = null;
    }
    if (delay === 0) {
      this.isProfileDropdownOpen.set(false);
      this.cdr.markForCheck();
      return;
    }
    this.profileDropdownTimeout = setTimeout(() => {
      this.isProfileDropdownOpen.set(false);
      this.profileDropdownTimeout = null;
      this.cdr.markForCheck();
    }, delay);
  }

  toggleProfileDropdown(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isLoggedIn()) {
      this.closeNotificationDropdown(0);
      this.isProductsMegaOpen = false;
      if (this.profileDropdownTimeout) {
        clearTimeout(this.profileDropdownTimeout);
        this.profileDropdownTimeout = null;
      }
      this.isProfileDropdownOpen.update(v => !v);
      this.cdr.markForCheck();
    } else {
      this.login();
    }
  }

  login(): void {
    this.authModalService.open('login');
    this.closeProfileDropdown(0);
  }
  logout(): void {    
    this.isSignOutModalOpen = true;    
    this.closeProfileDropdown(0);
  }

  confirmSignOut(): void {
    this.authService.logout();
    this.isSignOutModalOpen = false;

    const protectedRoutes = ['/account', '/profile', '/checkout', '/community'];
    const currentUrl = this.router.url;
    if (protectedRoutes.some(route => currentUrl.startsWith(route))) {
      this.router.navigate(['/']);
    }

    this.successModalConfig = {
      title: 'Signed Out Successfully',
      subtitle: 'See you next time!',
      primaryBtn: 'LOG IN'
    };
    this.showSuccessModal = true;
  }

  cancelSignOut(): void {
    this.isSignOutModalOpen = false;
  }

  onSuccessPrimary(): void {
    this.showSuccessModal = false;
    this.authModalService.open('login');
  }

  onSuccessSecondary(): void {
    this.showSuccessModal = false;
    this.authModalService.open('login');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // If the click occurred outside the component, close the dropdown
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.closeProfileDropdown(0);
      this.closeNotificationDropdown(0);
      this.isProductsMegaOpen = false;
    }
  }

  ngOnDestroy(): void {
    if (this.profileDropdownTimeout) {
      clearTimeout(this.profileDropdownTimeout);
      this.profileDropdownTimeout = null;
    }
    if (this.notificationDropdownTimeout) {
      clearTimeout(this.notificationDropdownTimeout);
      this.notificationDropdownTimeout = null;
    }
    this.stopNotificationPolling();
  }

  loadNotifications(): void {
    this.communityService.getNotifications().subscribe({
      next: (res) => {
        this.notifications.set(res.data || []);
        this.updateUnreadCount();
      },
      error: (err) => {
        console.error('Error fetching notifications:', err);
      }
    });
  }

  updateUnreadCount(): void {
    this.unreadNotificationCount = this.notifications().filter(n => !n.is_read).length;
  }

  startNotificationPolling(): void {
    this.stopNotificationPolling();
    if (isPlatformBrowser(this.platformId)) {
      this.notificationInterval = setInterval(() => {
        this.loadNotifications();
      }, 30000); // Poll every 30 seconds
    }
  }

  stopNotificationPolling(): void {
    if (this.notificationInterval) {
      clearInterval(this.notificationInterval);
      this.notificationInterval = null;
    }
  }

  openNotificationDropdown(): void {
    if (!this.isLoggedIn()) return;
    this.closeProfileDropdown(0);
    this.isProductsMegaOpen = false;
    if (this.notificationDropdownTimeout) {
      clearTimeout(this.notificationDropdownTimeout);
      this.notificationDropdownTimeout = null;
    }
    this.isNotificationDropdownOpen.set(true);
    this.loadNotifications();
    this.cdr.markForCheck();
  }

  closeNotificationDropdown(delay: number = 80): void {
    if (this.notificationDropdownTimeout) {
      clearTimeout(this.notificationDropdownTimeout);
      this.notificationDropdownTimeout = null;
    }
    if (delay === 0) {
      this.isNotificationDropdownOpen.set(false);
      this.cdr.markForCheck();
      return;
    }
    this.notificationDropdownTimeout = setTimeout(() => {
      this.isNotificationDropdownOpen.set(false);
      this.notificationDropdownTimeout = null;
      this.cdr.markForCheck();
    }, delay);
  }

  toggleNotificationDropdown(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isLoggedIn()) {
      this.login();
      return;
    }
    this.closeProfileDropdown(0);
    this.isProductsMegaOpen = false;
    if (this.notificationDropdownTimeout) {
      clearTimeout(this.notificationDropdownTimeout);
      this.notificationDropdownTimeout = null;
    }
    this.isNotificationDropdownOpen.update(v => !v);
    if (this.isNotificationDropdownOpen()) {
      this.loadNotifications();
    }
    this.cdr.markForCheck();
  }

  markAllNotificationsAsRead(): void {
    this.communityService.markAllNotificationsAsRead().subscribe({
      next: () => {
        this.notifications.update(notifs =>
          notifs.map(n => ({ ...n, is_read: true }))
        );
        this.updateUnreadCount();
      },
      error: (err) => {
        console.error('Error marking all notifications as read:', err);
      }
    });
  }

  deleteNotification(id: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    this.communityService.deleteNotification(id).subscribe({
      next: () => {
        this.notifications.update(notifs =>
          notifs.filter(n => n.notification_id !== id)
        );
        this.updateUnreadCount();
      },
      error: (err) => {
        console.error('Error deleting notification:', err);
      }
    });
  }

  deleteAllNotifications(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    this.communityService.deleteAllNotifications().subscribe({
      next: () => {
        this.notifications.set([]);
        this.updateUnreadCount();
      },
      error: (err) => {
        console.error('Error deleting all notifications:', err);
      }
    });
  }

  onNotificationClick(notification: Notification, event: Event): void {

    event.preventDefault();
    event.stopPropagation();

    // Mark as read in backend
    if (!notification.is_read) {
      this.communityService.markNotificationAsRead(notification.notification_id).subscribe({
        next: () => {
          this.notifications.update(notifs =>
            notifs.map(n => n.notification_id === notification.notification_id ? { ...n, is_read: true } : n)
          );
          this.updateUnreadCount();
        },
        error: (err) => {
          console.error('Error marking notification as read:', err);
        }
      });
    }

    // Close dropdown
    this.isNotificationDropdownOpen.set(false);
    this.cdr.markForCheck();

    // Navigate to post detail or order tracking
    const isOrderOrRefund = notification.type.startsWith('ORDER_') || notification.type.startsWith('REFUND_');
    if (notification.type === 'SUBSCRIPTION_NOT_STARTED' && notification.order_id) {
      // No box exists yet: open the order, where the customer can start it with another card.
      this.router.navigate(['/order-tracking'], { queryParams: { orderId: notification.order_id } });
    } else if (notification.type.startsWith('SUBSCRIPTION_')) {
      this.router.navigate(['/account'], { queryParams: { tab: 'ritual-box' } });
    } else if (notification.type.startsWith('PANTRY_')) {
      this.router.navigate(['/account'], { queryParams: { tab: 'pantry' } });
    } else if (isOrderOrRefund) {
      this.router.navigate(['/order-tracking'], { queryParams: { orderId: notification.post_id } });
    } else if (notification.type.startsWith('COMMUNITY_')) {
      // Moderation notices: open the post when there is one (a hidden post shows its own notice)
      if (notification.post_id) this.router.navigate(['/community/post', notification.post_id]);
    } else {
      this.router.navigate(['/community/post', notification.post_id]);
    }
  }

  /** Ritual Box notifications carry subscription_id / message; older ones stored them in post_id / comment_content. */
  ritualBoxId(item: Notification): string {
    return item.subscription_id || item.post_id || '';
  }

  ritualBoxMessage(item: Notification): string | null {
    return item.message || item.comment_content || null;
  }

  getNotificationTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;

    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} giờ trước`;

    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays} ngày trước`;
  }

  @HostListener('document:keydown.escape')
  onEscapeKeydown(): void {
    if (this.isSearchOpen) {
      this.closeSearch();
    }
    if (this.isCartOpen) {
      this.closeCart();
    }
  }

  goToProfile(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.router.navigate(['/account']);
    this.closeProfileDropdown(0);
  }

  openSearch(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.isSearchOpen = true;
    this.isMobileMenuOpen = false; // Close mobile drawer if open
    this.searchQuery = '';
    this.hasSearched = false;
    this.searchFilter = 'ALL';
    if (this.searchInput) {
      this.searchInput.nativeElement.value = '';
    }
    this.loadSearchData();
    setTimeout(() => {
      if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    }, 100);
  }

  closeSearch(): void {
    this.isSearchOpen = false;
    this.searchQuery = '';
    this.hasSearched = false;
    if (this.searchInput) {
      this.searchInput.nativeElement.value = '';
    }
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.hasSearched = false;
    this.filteredProducts = [];
    this.filteredRecipes = [];
    this.filteredBlogs = [];
    if (this.searchInput) {
      this.searchInput.nativeElement.value = '';
      this.searchInput.nativeElement.focus();
    }
  }

  loadSearchData(): void {
    this.isLoadingResults = true;
    
    // Fetch all products
    this.productService.getProducts().subscribe({
      next: (products) => {
        this.allProducts = products;
        this.filterResults();
        this.isLoadingResults = false;
      },
      error: (err) => {
        console.error('Error fetching search products:', err);
        this.isLoadingResults = false;
      }
    });

    // Fetch all recipes
    this.recipeService.getRecipes(100).subscribe({
      next: (recipes) => {
        this.allRecipes = recipes;
        this.filterResults();
      },
      error: (err) => console.error('Error fetching search recipes:', err)
    });

    // Fetch all blogs
    this.contentService.getBlogs({ limit: 100 }).subscribe({
      next: (res) => {
        this.allBlogs = res.data || [];
        this.filterResults();
      },
      error: (err) => console.error('Error fetching search blogs:', err)
    });
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    if (!value.trim()) {
      this.hasSearched = false;
      this.filteredProducts = [];
      this.filteredRecipes = [];
      this.filteredBlogs = [];
    } else {
      this.hasSearched = true;
      this.filterResults();
    }
  }

  filterResults(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredProducts = [];
      this.filteredRecipes = [];
      this.filteredBlogs = [];
      return;
    }

    const keywords = q.split(/\s+/).filter(Boolean);

    this.filteredProducts = this.allProducts.filter(p => {
      const searchableText = `${p.name || ''} ${p.description || ''} ${p.category || ''}`.toLowerCase();
      return keywords.every(kw => searchableText.includes(kw));
    });

    this.filteredRecipes = this.allRecipes.filter(r => {
      const tagsStr = (r.metadata?.tags || []).join(' ');
      const searchableText = `${r.title || ''} ${r.description || ''} ${tagsStr}`.toLowerCase();
      return keywords.every(kw => searchableText.includes(kw));
    });

    this.filteredBlogs = this.allBlogs.filter(b => {
      const tagsStr = (b.tags || []).join(' ');
      const searchableText = `${b.title || ''} ${b.excerpt || ''} ${tagsStr} ${b.category || ''}`.toLowerCase();
      return keywords.every(kw => searchableText.includes(kw));
    });
  }

  performSearch(): void {
    if (this.searchInput) {
      this.searchQuery = this.searchInput.nativeElement.value;
    }
    if (this.searchQuery.trim()) {
      this.goToSearchResultsPage();
    }
  }

  goToSearchResultsPage(tab?: string): void {
    console.log('goToSearchResultsPage called with query:', this.searchQuery, 'and tab:', tab);
    if (this.searchQuery.trim()) {
      const queryParams: any = { q: this.searchQuery.trim() };
      if (tab) {
        queryParams.tab = tab;
      }
      this.router.navigate(['/search'], { queryParams })
        .then(success => console.log('Navigation success:', success))
        .catch(err => console.error('Navigation error:', err));
      this.closeSearch();
    } else {
      console.warn('searchQuery is empty');
    }
  }

  selectTag(tag: string): void {
    if (this.searchInput) {
      this.searchInput.nativeElement.value = tag;
    }
    this.searchQuery = tag;
    this.hasSearched = true;
    this.filterResults();
  }

  setFilter(filter: 'ALL' | 'PRODUCTS' | 'JOURNAL' | 'RECIPES'): void {
    this.searchFilter = filter;
  }

  getProductOriginString(product: Product): string {
    if (product.category === 'matcha') {
      return product.matcha?.origin || 'Japan';
    } else if (product.category === 'coffee') {
      const origin = product.coffee?.product_origin || '';
      const roast = product.coffee?.roast_level || '';
      return [origin, roast].filter(Boolean).join(' · ');
    }
    return '';
  }

  getBlogBadgeStyles(category: string): { [key: string]: string } {
    const cat = (category || '').toLowerCase().trim();
    if (cat === 'stories') {
      return { 'background-color': '#E8D5B0', 'color': '#544A40' };
    } else if (cat === 'brewing-guides' || cat === 'brewing guides') {
      return { 'background-color': '#544A40', 'color': '#FAF0EB' };
    } else if (cat === 'tea-education' || cat === 'tea education') {
      return { 'background-color': '#CFE1B9', 'color': '#375534' };
    }
    return { 'background-color': '#eae1dc', 'color': '#544A40' };
  }

  getRecipeBadgeStyles(tag: string): { [key: string]: string } {
    const t = (tag || '').toUpperCase().trim();
    const map: Record<string, { bg: string, text: string }> = {
      HOT:      { bg: '#EFB5D0', text: '#544A40' },
      COLD:     { bg: '#CFE1B9', text: '#375534' },
      DESSERT:  { bg: '#E8D5B0', text: '#544A40' },
      COCKTAIL: { bg: '#CFE1B9', text: '#375534' },
    };
    const colors = map[t] || { bg: '#CFE1B9', text: '#375534' };
    return { 'background-color': colors.bg, 'color': colors.text };
  }

  get isCartOpen(): boolean {
    return this.cartService.isOpen();
  }

  set isCartOpen(value: boolean) {
    this.cartService.isOpen.set(value);
  }

  get cartItems(): CartItem[] {
    const items = this.cartService.cartItems();
    return [...items].sort((a, b) => {
      const aOut = this.isItemOutOfStock(a) ? 1 : 0;
      const bOut = this.isItemOutOfStock(b) ? 1 : 0;
      return aOut - bOut;
    });
  }

  get cartCount(): number {
    return this.cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  get subtotal(): number {
    return this.checkoutLines.reduce((sum, item) => sum + this.getChargedLineTotal(item), 0);
  }

  // Selected, in-stock lines — what checkout will actually charge.
  private get checkoutLines(): CartItem[] {
    return this.cartItems.filter(item => item.selected && !this.isItemOutOfStock(item));
  }

  private getChargedLineTotal(item: CartItem): number {
    if (item.bundle) return getCartItemLineTotal(item);
    return getCartItemChargedUnitPrice(item) * item.quantity;
  }

  // ── Subscribe & Save ──────────────────────────────────────────────────

  readonly frequencyOptions = SUBSCRIPTION_FREQUENCY_OPTIONS;

  isSubscription(item: CartItem): boolean {
    return isSubscriptionItem(item);
  }

  isSubscriptionEligible(item: CartItem): boolean {
    return !item.bundle && isSubscriptionEligibleProduct(item.product);
  }

  getSubscribeDiscountPercent(item: CartItem): number {
    return getSubscribeDiscountPercent(item.product);
  }

  getOriginalLineTotal(item: CartItem): number {
    return getCartItemOriginalUnitPrice(item) * item.quantity;
  }

  /** Each later Ritual Box delivery (Subscribe & Save price); the first box is full price. */
  getRecurringLineTotal(item: CartItem): number {
    return getCartItemRecurringUnitPrice(item) * item.quantity;
  }

  setPurchaseType(item: CartItem, purchaseType: PurchaseType): void {
    this.cartService.setPurchaseType(item, purchaseType);
  }

  changeFrequency(item: CartItem, days: number | string): void {
    this.cartService.setSubscriptionFrequency(item, Number(days) as SubscriptionFrequencyDays);
  }

  get hasSubscriptionLines(): boolean {
    return this.checkoutLines.some(item => isSubscriptionItem(item));
  }

  get oneTimeLineCount(): number {
    return this.checkoutLines
      .filter(item => !isSubscriptionItem(item))
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  get oneTimeTotal(): number {
    return this.checkoutLines
      .filter(item => !isSubscriptionItem(item))
      .reduce((sum, item) => sum + this.getChargedLineTotal(item), 0);
  }

  // One "Ritual Box" row per delivery frequency.
  get subscriptionGroups(): Array<{ days: SubscriptionFrequencyDays; label: string; total: number }> {
    const groups = new Map<SubscriptionFrequencyDays, number>();
    for (const item of this.checkoutLines) {
      if (!isSubscriptionItem(item) || !item.subscriptionFrequencyDays) continue;
      const days = item.subscriptionFrequencyDays;
      groups.set(days, (groups.get(days) ?? 0) + this.getRecurringLineTotal(item));
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([days, total]) => ({ days, label: getSubscriptionFrequencyLabel(days).toLowerCase(), total }));
  }

  // Saved on every delivery after the first = original price × subscribe_discount_percent.
  get subscriptionSavings(): number {
    const cents = this.checkoutLines
      .filter(item => isSubscriptionItem(item))
      .reduce((sum, item) =>
        sum + this.getOriginalLineTotal(item) * this.getSubscribeDiscountPercent(item), 0);
    return Math.round(cents) / 100;
  }

  isBundleItem(item: CartItem): boolean {
    return isBundleCartItem(item);
  }

  getItemImage(item: CartItem): string {
    return getCartItemImage(item);
  }

  getLineTotal(item: CartItem): number {
    if (item.bundle) {
      return getBundleSaleLineTotal(item);
    }
    return this.getChargedLineTotal(item);
  }

  getComponentImage = getBundleComponentImage;
  getComponentDisplayName = getBundleComponentDisplayName;
  getBundleContentComponents = getBundleContentComponents;
  getBundleContentToggleLabel = getBundleContentToggleLabel;
  getBundleComponentLineQuantity = getBundleComponentLineQuantity;
  bundleComponentHasVariantOptions = bundleComponentHasVariantOptions;
  getBundleComponentVariants = getBundleComponentInStockVariants;
  trackBundleComponent = (_: number, component: BundleComponentSelection) =>
    getBundleComponentTrackKey(component);

  getItemKey(item: CartItem): string {
    return `${this.getProductIdentifier(item)}::${item.variantSku}::${getPurchaseType(item)}`;
  }

  isKitContentExpanded(item: CartItem): boolean {
    return this.expandedKitKeys.has(this.getItemKey(item));
  }

  toggleKitContent(item: CartItem): void {
    const key = this.getItemKey(item);
    if (this.expandedKitKeys.has(key)) {
      this.expandedKitKeys.delete(key);
    } else {
      this.expandedKitKeys.add(key);
    }
  }

  getVariant(item: CartItem) {
    return item.product.variants.find(v => v.sku === item.variantSku) || item.product.variants[0];
  }

  isItemOutOfStock(item: CartItem): boolean {
    if (item.bundle) {
      return item.bundle.components.some((component) => {
        const variant = component.product.variants.find((entry) => entry.sku === component.variantSku)
          ?? component.product.variants[0];
        return !variant || variant.stock <= 0;
      });
    }

    const variant = this.getVariant(item);
    return variant ? variant.stock <= 0 : true;
  }

  get isAllSelected(): boolean {
    const inStockItems = this.cartItems.filter(item => !this.isItemOutOfStock(item));
    if (inStockItems.length === 0) return false;
    return inStockItems.every(item => item.selected);
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.cartService.setSelectAll(checked);
  }

  get hasSelectedItems(): boolean {
    return this.cartItems.some(item => item.selected && !this.isItemOutOfStock(item));
  }

  openCart(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.cartService.openCart();
    this.isMobileMenuOpen = false;
    this.isSearchOpen = false;
  }

  closeCart(): void {
    this.cartService.closeCart();
  }

  incrementQuantity(item: CartItem): void {
    this.cartService.updateQuantity(this.getProductIdentifier(item), item.variantSku, item.quantity + 1, getPurchaseType(item));
  }

  decrementQuantity(item: CartItem): void {
    this.cartService.updateQuantity(this.getProductIdentifier(item), item.variantSku, item.quantity - 1, getPurchaseType(item));
  }

  removeFromCart(item: CartItem): void {
    this.cartService.removeFromCart(this.getProductIdentifier(item), item.variantSku, getPurchaseType(item));
  }

  removeSelected(): void {
    this.cartService.removeSelected();
  }

  toggleSelection(item: CartItem): void {
    this.cartService.toggleSelection(this.getProductIdentifier(item), item.variantSku, getPurchaseType(item));
  }

  changeVariant(item: CartItem, newSku: string): void {
    this.cartService.updateVariant(this.getProductIdentifier(item), item.variantSku, newSku, getPurchaseType(item));
  }

  changeBundleComponentVariant(
    item: CartItem,
    component: BundleComponentSelection,
    newVariantSku: string
  ): void {
    this.cartService.updateBundleComponentVariant(
      item.variantSku,
      component.product.product_id,
      component.variantSku,
      newVariantSku,
      getBundleComponentTrackKey(component)
    );
  }

  getCartItemDetailLink(item: CartItem): Array<string | number> {
    if (this.isBundleItem(item)) {
      return ['/shop/build-your-bundle'];
    }

    return ['/products', getProductDetailSlug(item.product)];
  }

  getProductDetailLink(product: Product): Array<string | number> {
    return ['/products', getProductDetailSlug(product)];
  }

  openCartItemDetail(): void {
    this.closeCart();
  }

  checkout(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    // Ritual Box (subscription) needs an account for recurring billing —
    // guests must sign in or switch those lines to one-time first.
    if (this.hasSubscriptionLines && !this.isLoggedIn()) {
      this.awaitingSubscriptionPrompt.set(true);
      this.authPromptService.open();
      return;
    }
    this.cartService.processCheckout();
    this.router.navigate(['/checkout']);
  }

  // Guest dismissed the sign-in prompt (LATER / close) instead of logging in:
  // keep them in the cart and flip the selected Ritual Box lines to one-time.
  private switchSubscriptionsToOneTime(): void {
    for (const item of this.checkoutLines.filter(it => isSubscriptionItem(it))) {
      this.cartService.setPurchaseType(item, 'one_time');
    }
  }

  private getProductIdentifier(item: CartItem): string | number {
    return item.product._id || item.product.product_id;
  }

  // ── Notification tab helpers ─────────────────────────────────────────────

  setNotificationTab(tab: string): void {
    this.activeNotificationTab.set(tab);
  }

  getFilteredNotifications(): Notification[] {
    const tab = this.activeNotificationTab();
    const all = this.notifications();
    if (tab === 'ALL') return all;
    if (tab === 'ORDERS') return all.filter(n =>
      n.type.startsWith('ORDER_') || n.type.startsWith('REFUND_')
    );
    if (tab === 'COMMUNITY') return all.filter(n =>
      n.type.startsWith('POST_') || n.type.startsWith('COMMENT_')
    );
    if (tab === 'RITUAL_BOX') return all.filter(n => n.type.startsWith('SUBSCRIPTION_'));
    if (tab === 'PANTRY') return all.filter(n => n.type.startsWith('PANTRY_'));
    return [];
  }

  /**
   * Returns a CSS modifier class for the notification icon background.
   * Colors match the tier/palette system.
   */
  getNotificationIconBgClass(type: string): string {
    switch (type) {
      case 'ORDER_PLACED':     return 'notif-icon--blue';
      case 'ORDER_SHIPPING':   return 'notif-icon--blue';
      case 'ORDER_CANCELED':   return 'notif-icon--red';
      case 'ORDER_DELIVERY_FAILED':   return 'notif-icon--orange';
      case 'ORDER_CANCELED_BY_STORE': return 'notif-icon--red';
      case 'REFUND_REQUESTED': return 'notif-icon--orange';
      case 'REFUND_APPROVED':  return 'notif-icon--green';
      case 'REFUND_REJECTED':  return 'notif-icon--red';
      case 'SUBSCRIPTION_PAUSED':    return 'notif-icon--orange';
      case 'SUBSCRIPTION_RESUMED':   return 'notif-icon--green';
      case 'SUBSCRIPTION_CANCELLED': return 'notif-icon--red';
      case 'SUBSCRIPTION_UPCOMING':       return 'notif-icon--sage';
      case 'SUBSCRIPTION_PAYMENT_FAILED': return 'notif-icon--red';
      case 'SUBSCRIPTION_SUSPENDED':      return 'notif-icon--red';
      case 'SUBSCRIPTION_OUT_OF_STOCK':   return 'notif-icon--orange';
      case 'SUBSCRIPTION_SKIPPED':        return 'notif-icon--gray';
      case 'SUBSCRIPTION_PROPOSAL':       return 'notif-icon--sage';
      case 'SUBSCRIPTION_PROPOSAL_WITHDRAWN': return 'notif-icon--gray';
      case 'SUBSCRIPTION_NOT_STARTED':    return 'notif-icon--red';
      case 'SUBSCRIPTION_ADJUSTED':       return 'notif-icon--sage';
      case 'PANTRY_EXPIRY_SOON': return 'notif-icon--orange';
      case 'POST_CREATED':     return 'notif-icon--green';
      case 'POST_LIKED':       return 'notif-icon--pink';
      case 'POST_COMMENTED':   return 'notif-icon--sage';
      case 'COMMENT_REPLIED':  return 'notif-icon--sage';
      case 'COMMENT_LIKED':    return 'notif-icon--pink';
      default:                 return 'notif-icon--gray';
    }
  }

  // ── User profile helpers for dropdown ──────────────────────────────────

  /** Use the same public identity and initials as community comments. */
  getUserInitials(): string {
    const user = this.authService.currentUser() || this.authService.getUser();
    return avatarInitials(user?.community_name || user?.profile_name || user?.name || user?.email);
  }

  /** Full display name */
  getUserProfileName(): string {
    const user = this.authService.currentUser() || this.authService.getUser();
    return user?.profile_name || user?.name || user?.email || '';
  }

  /** Link to the signed-in user's own community profile page. */
  myCommunityProfileLink(): string[] {
    const user = this.authService.currentUser() || this.authService.getUser();
    return user?.user_id ? ['/community/profile', user.user_id] : ['/community'];
  }

  /** Community handle without leading @ */
  getUserCommunityName(): string {
    const user = this.authService.currentUser() || this.authService.getUser();
    return user?.community_name || '';
  }

  /** Avatar URL, or empty string if none */
  getUserAvatarUrl(): string {
    const user = this.authService.currentUser() || this.authService.getUser();
    return user?.avatar_url || '';
  }

  /**
   * Membership tier. Falls back to 'Seed'.
   * Values: 'Seed' | 'Leaf' | 'Bloom' | 'Zen'
   */
  getUserTier(): string {
    const user = this.authService.currentUser() || this.authService.getUser();
    return user?.membership_tier || 'Seed';
  }

  /** Tier as shown in the cart badge: Seed | Leaf | Bloom | Zen */
  getUserTierLabel(): string {
    const tier = this.getUserTier().trim().toLowerCase();
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  /** CSS modifier class for the tier badge */
  getTierClass(): string {
    return 'tier-' + this.getUserTier().toLowerCase();
  }
}
