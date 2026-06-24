import { Component, OnInit, inject, PLATFORM_ID, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
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
  LucideChevronDown
} from '@lucide/angular';
import { AuthService } from '../../../core/auth.service';
import { AuthModalService } from '../../../core/auth-modal.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    CommonModule,
    LucideSearch,
    LucideShoppingCart,
    LucideShoppingBag,
    LucideUser,
    LucideX,
    LucideMenu,
    LucideLogIn,
    LucideLogOut,
    LucideClipboardClock,
    LucideChevronDown
  ],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private elementRef = inject(ElementRef);

  isPromobarVisible = true;
  isMobileMenuOpen = false;
  isProfileDropdownOpen = false;
  isMobileProductsOpen = false;
  isMobileAboutOpen = false;
  isSearchOpen = false;
  isCartOpen = false;

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
    this.authService.logout();
    this.isProfileDropdownOpen = false;
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
    this.isProfileDropdownOpen = !this.isProfileDropdownOpen;
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

  openCart(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.isCartOpen = true;
    this.isMobileMenuOpen = false;
    this.isSearchOpen = false;
  }

  closeCart(): void {
    this.isCartOpen = false;
  }
}
