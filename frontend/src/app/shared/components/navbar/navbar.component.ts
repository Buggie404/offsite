// components/navbar/navbar.component.ts
import { Component, OnInit, inject, PLATFORM_ID, HostListener, ElementRef, ViewChild } from '@angular/core';
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
  LucideArrowRight
} from '@lucide/angular';
import { AuthService } from '../../../core/auth.service';
import { AuthModalService } from '../../../core/auth-modal.service';
import { CartService, CartItem } from '../../../features/purchase/services/cart.service';
import { ProductService } from '../../../features/home/services/product.service';
import { RecipeService } from '../../../features/home/services/recipe.service';
import { ContentService } from '../../../features/content/services/content.service';
import { Product } from '../../../features/home/models/product.model';
import { Recipe } from '../../../features/home/models/recipe.model';
import { FormsModule } from '@angular/forms';

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
    FormsModule
  ],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private elementRef = inject(ElementRef);
  private router = inject(Router);
  private cartService = inject(CartService);
  private productService = inject(ProductService);
  private recipeService = inject(RecipeService);
  private contentService = inject(ContentService);

  isPromobarVisible = true;
  isMobileMenuOpen = false;
  isProfileDropdownOpen = false;
  isMobileProductsOpen = false;
  isMobileAboutOpen = false;
  isSearchOpen = false;
  isAboutDropdownOpen = false;
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

  // Read-only signal from auth service
  isLoggedIn = this.authService.isAuthenticated;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      const closed = localStorage.getItem('promobar-closed');
      if (closed === 'true') {
        this.isPromobarVisible = false;
      }
    }

    // Close all dropdowns when route changes
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.isProfileDropdownOpen = false;
      this.isMobileMenuOpen = false;
      this.isMobileProductsOpen = false;
      this.isMobileAboutOpen = false;
      this.isAboutDropdownOpen = false;
    });
  }

  closePromobar(): void {
    this.isPromobarVisible = false;
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('promobar-closed', 'true');
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

  openProfileDropdown(): void {
    this.isProfileDropdownOpen = true;
  }

  login(): void {
    this.authModalService.open('login');
    this.isProfileDropdownOpen = false;
  }
  logout(): void {    
    this.isSignOutModalOpen = true;    
    this.isProfileDropdownOpen = false;
  }

  confirmSignOut(): void {
    this.authService.logout();
    this.isSignOutModalOpen = false;

    const protectedRoutes = ['/account', '/profile', '/checkout'];
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
      this.isProfileDropdownOpen = false;
    }
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

  closeProfileDropdown(): void {
    this.isProfileDropdownOpen = false;
  }

  toggleProfileDropdown(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isLoggedIn()) {
      this.router.navigate(['/account']);
      this.isProfileDropdownOpen = false;
    } else {
      this.login();
    }
  }

  goToProfile(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.router.navigate(['/account']);
    this.isProfileDropdownOpen = false;
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
    return this.cartItems.reduce((sum, item) => {
      if (!item.selected) return sum;
      const variant = this.getVariant(item);
      if (!variant || variant.stock <= 0) return sum;
      return sum + variant.price * item.quantity;
    }, 0);
  }

  getVariant(item: CartItem) {
    return item.product.variants.find(v => v.sku === item.variantSku) || item.product.variants[0];
  }

  isItemOutOfStock(item: CartItem): boolean {
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
    this.cartService.updateQuantity(this.getProductIdentifier(item), item.variantSku, item.quantity + 1);
  }

  decrementQuantity(item: CartItem): void {
    this.cartService.updateQuantity(this.getProductIdentifier(item), item.variantSku, item.quantity - 1);
  }

  removeFromCart(item: CartItem): void {
    this.cartService.removeFromCart(this.getProductIdentifier(item), item.variantSku);
  }

  removeSelected(): void {
    this.cartService.removeSelected();
  }

  toggleSelection(item: CartItem): void {
    this.cartService.toggleSelection(this.getProductIdentifier(item), item.variantSku);
  }

  changeVariant(item: CartItem, newSku: string): void {
    this.cartService.updateVariant(this.getProductIdentifier(item), item.variantSku, newSku);
  }

  checkout(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    this.cartService.processCheckout();
    this.router.navigate(['/checkout']);
  }

  private getProductIdentifier(item: CartItem): string | number {
    return item.product._id || item.product.product_id;
  }
}
