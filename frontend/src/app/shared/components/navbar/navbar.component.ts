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
  LucideMinus
} from '@lucide/angular';
import { AuthService } from '../../../core/auth.service';
import { AuthModalService } from '../../../core/auth-modal.service';
import { CartService, CartItem } from '../../../features/purchase/services/cart.service';
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

  isPromobarVisible = true;
  isMobileMenuOpen = false;
  isProfileDropdownOpen = false;
  isMobileProductsOpen = false;
  isMobileAboutOpen = false;
  isSearchOpen = false;
  isAboutDropdownOpen = false;
  isSignOutModalOpen = false;

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
    setTimeout(() => {
      if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    }, 100);
  }

  closeSearch(): void {
    this.isSearchOpen = false;
    if (this.searchInput) {
      this.searchInput.nativeElement.value = '';
    }
  }

  performSearch(): void {
    if (this.searchInput) {
      const query = this.searchInput.nativeElement.value;
      console.log('Searching for:', query);
    }
    this.closeSearch();
  }

  selectTag(tag: string): void {
    if (this.searchInput) {
      this.searchInput.nativeElement.value = tag;
      this.searchInput.nativeElement.focus();
    }
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
    this.cartService.updateQuantity(item.product._id, item.variantSku, item.quantity + 1);
  }

  decrementQuantity(item: CartItem): void {
    this.cartService.updateQuantity(item.product._id, item.variantSku, item.quantity - 1);
  }

  removeFromCart(item: CartItem): void {
    this.cartService.removeFromCart(item.product._id, item.variantSku);
  }

  toggleSelection(item: CartItem): void {
    this.cartService.toggleSelection(item.product._id, item.variantSku);
  }

  changeVariant(item: CartItem, newSku: string): void {
    this.cartService.updateVariant(item.product._id, item.variantSku, newSku);
  }

  checkout(event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    this.cartService.processCheckout();
    this.router.navigate(['/checkout']);
  }
}
