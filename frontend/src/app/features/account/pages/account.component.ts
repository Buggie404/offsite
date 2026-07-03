import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { UserAddress, UserPaymentMethod } from '../../../shared/models/user.model';
import { CheckoutService } from '../../purchase/services/checkout.service';
import { CartService } from '../../purchase/services/cart.service';
import { ReviewModalComponent } from '../../purchase/components/review-modal/review-modal.component';
import { AddressModalComponent } from '../../../shared/components/address-modal/address-modal.component';
import { DeleteAddressModalComponent } from '../../../shared/components/delete-address-modal/delete-address-modal.component';
import { InlineValidator, FieldConfig } from '../../../shared/utils/inline-validator';

const VIETNAM_BANK_LIST = ['Vietcombank', 'BIDV', 'Techcombank', 'VietinBank', 'Agribank', 'MB Bank', 'VPBank', 'ACB', 'Sacombank', 'TPBank', 'VIB', 'SHB', 'MSB', 'SeABank'];
import {
  LucideUser,
  LucideShoppingBag,
  LucideHeart,
  LucideMapPin,
  LucideCreditCard,
  LucideLogOut,
  LucideX,
  LucideCheck,
  LucideLoader,
  LucideMenu,
  LucideSearch,
  LucideTruck,
  LucideRefreshCw,
  LucideStar,
  LucidePackageCheck,
  LucideChevronLeft,
  LucideChevronRight,
  LucideTrash2,
  LucidePencil
} from '@lucide/angular';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    LucideUser,
    LucideShoppingBag,
    LucideHeart,
    LucideMapPin,
    LucideCreditCard,
    LucideLogOut,
    LucideX,
    LucideCheck,
    LucideLoader,
    LucideMenu,
    LucideSearch,
    LucideTruck,
    LucideRefreshCw,
    LucideStar,
    LucidePackageCheck,
    LucideChevronLeft,
    LucideChevronRight,
    LucideTrash2,
    LucidePencil,
    ReviewModalComponent,
    AddressModalComponent,
    DeleteAddressModalComponent
  ],
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss'
})
export class AccountComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private checkoutService = inject(CheckoutService);
  private cartService = inject(CartService);

  // Profile data signals
  user = signal<any>(null);
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);

  // Tab & Modal State
  activeTab = signal<string>('profile');
  showEditModal = signal<boolean>(false);
  showPasswordModal = signal<boolean>(false);
  isSidebarOpen = signal<boolean>(false);

  // Address Modal State
  showAddressModal = signal<boolean>(false);
  selectedAddressForEdit = signal<any>(null);
  isOnlyAddress = signal<boolean>(false);

  sortedAddresses = computed(() => {
    const list = this.user()?.addresses || [];
    return [...list].sort((a, b) => {
      const aDef = a.is_default || false;
      const bDef = b.is_default || false;
      if (aDef && !bDef) return -1;
      if (!aDef && bDef) return 1;
      return 0;
    });
  });

  // Delete Address Modal State
  showDeleteAddressModal = signal<boolean>(false);
  selectedAddressForDelete = signal<any>(null);

  // Payment Cards State
  isAddingCard = signal<boolean>(false);
  
  sortedPaymentMethods = computed(() => {
    const list = this.user()?.payment_methods || [];
    return [...list].sort((a, b) => {
      const aExp = this.isCardExpired(a.expire_date);
      const bExp = this.isCardExpired(b.expire_date);
      if (aExp && !bExp) return 1;
      if (!aExp && bExp) return -1;
      return 0;
    });
  });

  get inlineCardBrand(): string | null {
    if (!this.cardForm) return null;
    if (this.cardForm.card_type === 'NAPAS') return 'Napas';
    const digits = this.cardForm.card_number.replace(/\s+/g, '');
    if (digits.startsWith('4')) return 'Visa';
    if (digits.startsWith('5') || digits.startsWith('2')) return 'Mastercard';
    return null;
  }

  getCardBrand(c: UserPaymentMethod): 'visa' | 'mastercard' | 'napas' {
    if (c.card_type === 'NAPAS') {
      return 'napas';
    }
    const num = (c.card_number || '').trim();
    if (num.startsWith('4')) {
      return 'visa';
    }
    const prefix2 = num.slice(0, 2);
    const prefix4 = parseInt(num.slice(0, 4), 10);
    const p2Val = parseInt(prefix2, 10);

    if ((p2Val >= 51 && p2Val <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) {
      return 'mastercard';
    }
    return 'visa';
  }

  getCardThumbnail(c: UserPaymentMethod): string {
    const brand = this.getCardBrand(c);
    return `assets/images/payment_${brand}.png`;
  }

  isCardExpired(expireDate: string): boolean {
    if (!expireDate || !expireDate.includes('/')) return true;
    const [monthStr, yearStr] = expireDate.split('/');
    const month = parseInt(monthStr, 10);
    const year = parseInt('20' + yearStr, 10);
    if (isNaN(month) || isNaN(year)) return true;

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    if (year < currentYear) return true;
    if (year === currentYear && month < currentMonth) return true;
    return false;
  }

  // Orders Tab State
  orders = signal<any[]>([]);
  isLoadingOrders = signal<boolean>(false);
  orderStatusFilter = signal<string>('all');
  orderSearchQuery = signal<string>('');
  orderSortBy = signal<string>('newest');
  currentPage = signal<number>(1);
  pageSize = 6;

  // Review Modal State
  selectedOrderForReview = signal<any>(null);
  showReviewModal = signal<boolean>(false);

  // Computeds for Stats
  totalOrdersCount = computed(() => this.orders().length);
  totalSpentSum = computed(() => {
    return this.orders()
      .filter(o => {
        const s = (o.order_status || '').toLowerCase();
        return s !== 'canceled' && s !== 'cancelled' && s !== 'refund';
      })
      .reduce((sum, o) => sum + (o.pricing?.total || 0), 0);
  });
  inTransitCount = computed(() => {
    return this.orders().filter(o => (o.order_status || '').toLowerCase() === 'shipping').length;
  });
  pendingCount = computed(() => {
    return this.orders().filter(o => (o.order_status || '').toLowerCase() === 'pending').length;
  });

  // Computeds for filtered and paginated list
  filteredOrders = computed(() => {
    let list = [...this.orders()];

    // 1. Filter by status
    const filter = this.orderStatusFilter().toLowerCase();
    if (filter !== 'all') {
      list = list.filter(o => (o.order_status || '').toLowerCase() === filter);
    }

    // 2. Filter by search query (order_id or product names)
    const query = this.orderSearchQuery().trim().toLowerCase();
    if (query) {
      list = list.filter(o => 
        (o.order_id || '').toLowerCase().includes(query) ||
        o.items?.some((it: any) => (it.product_name || '').toLowerCase().includes(query))
      );
    }

    // 3. Sort
    const sortBy = this.orderSortBy();
    if (sortBy === 'newest') {
      list.sort((a, b) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime());
    } else if (sortBy === 'oldest') {
      list.sort((a, b) => new Date(a.created_at || a.createdAt || 0).getTime() - new Date(b.created_at || b.createdAt || 0).getTime());
    } else if (sortBy === 'price_low') {
      list.sort((a, b) => (a.pricing?.total || 0) - (b.pricing?.total || 0));
    } else if (sortBy === 'price_high') {
      list.sort((a, b) => (b.pricing?.total || 0) - (a.pricing?.total || 0));
    }

    return list;
  });

  totalPages = computed(() => Math.ceil(this.filteredOrders().length / this.pageSize));

  paginatedOrders = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredOrders().slice(start, end);
  });

  // Messages
  successMessage = signal<string>('');
  errorMessage = signal<string>('');

  // Forms
  profileForm!: FormGroup;
  passwordForm!: FormGroup;

  cardForm = {
    card_type: 'credit' as 'credit' | 'debit' | 'NAPAS',
    card_number: '',
    cardholder_name: '',
    expire_date: '',
    cvc: '',
    issued_bank: '',
    is_default: false
  };

  cardValidator: InlineValidator | null = null;

  ngOnInit(): void {
    this.initForms();
    this.fetchProfile();
    this.fetchOrders();
    this.route.queryParams.subscribe(params => {
      if (params['tab']) {
        this.activeTab.set(params['tab']);
      }
    });

    if (typeof window !== 'undefined') {
      (window as any).getAccountCardType = () => this.cardForm.card_type;
      (window as any).validateAccountCardNumberFormat = (value: string, type: string) => {
        const digits = (value || '').replace(/\s+/g, '');
        if (type === 'NAPAS') {
          if (!digits.startsWith('9704')) return true;
          if (digits.length < 16 || digits.length > 19) return true;
          return false;
        } else {
          const isVisa = digits.startsWith('4') && (digits.length === 13 || digits.length === 16);
          const p2Val = parseInt(digits.slice(0, 2), 10);
          const prefix4 = parseInt(digits.slice(0, 4), 10);
          const isMaster = ((p2Val >= 51 && p2Val <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) && digits.length === 16;
          if (!isVisa && !isMaster) return true;
          return false;
        }
      };
      (window as any).isAccountCardExpiredCheck = (value: string) => {
        const clean = (value || '').trim();
        const match = clean.match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
        if (!match) return true;
        const expMonth = parseInt(match[1], 10);
        const expYear = parseInt('20' + match[2], 10);
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        if (expYear < currentYear) return true;
        if (expYear === currentYear && expMonth <= currentMonth) return true;
        return false;
      };
      (window as any).isValidAccountBank = (val: string) => {
        return VIETNAM_BANK_LIST.includes((val || '').trim());
      };
    }
  }

  ngOnDestroy(): void {
    if (this.cardValidator) {
      this.cardValidator.detach();
      this.cardValidator = null;
    }
    if (typeof window !== 'undefined') {
      delete (window as any).getAccountCardType;
      delete (window as any).validateAccountCardNumberFormat;
      delete (window as any).isAccountCardExpiredCheck;
      delete (window as any).isValidAccountBank;
    }
  }

  private initForms(): void {
    this.profileForm = this.fb.group({
      profile_name: ['', [Validators.required, Validators.minLength(2)]],
      community_name: [''],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.pattern(/^[0-9]{10,11}$/)]]
    });

    this.passwordForm = this.fb.group({
      oldPassword: ['', [Validators.required, Validators.minLength(8)]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  private passwordMatchValidator(g: FormGroup) {
    return g.get('newPassword')?.value === g.get('confirmPassword')?.value
      ? null : { mismatch: true };
  }

  async fetchProfile(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    this.isLoading.set(true);
    try {
      this.http.get<{ user: any }>('/api/auth/me').subscribe({
        next: (response) => {
          this.user.set(response.user);
          // Sync localStorage
          localStorage.setItem('user', JSON.stringify(response.user));
          
          this.profileForm.patchValue({
            profile_name: response.user.profile_name || '',
            community_name: response.user.community_name || '',
            email: response.user.email || '',
            phone: response.user.phone || ''
          });
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load profile:', err);
          this.errorMessage.set(err.error?.error || 'Failed to load profile information.');
          this.isLoading.set(false);
        }
      });
    } catch (e) {
      this.isLoading.set(false);
    }
  }

  switchTab(tab: string): void {
    this.activeTab.set(tab);
    this.closeSidebar();
    this.scrollToContent();
  }

  private scrollToContent(): void {
    if (isPlatformBrowser(this.platformId)) {
      const contentPanel = document.querySelector('.content-panel') as HTMLElement;
      if (contentPanel) {
        const headerHeight = 160; // promobar (80px) + navbar (80px)
        const elementPosition = contentPanel.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
          top: elementPosition - headerHeight,
          behavior: 'smooth'
        });
      }
    }
  }

  toggleSidebar(): void {
    this.isSidebarOpen.set(!this.isSidebarOpen());
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }

  openEditModal(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    if (this.user()) {
      this.profileForm.patchValue({
        profile_name: this.user().profile_name || '',
        community_name: this.user().community_name || '',
        email: this.user().email || '',
        phone: this.user().phone || ''
      });
    }
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.profileForm.reset();
  }

  openPasswordModal(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.showPasswordModal.set(true);
  }

  closePasswordModal(): void {
    this.showPasswordModal.set(false);
    this.passwordForm.reset();
  }

  onUpdateProfile(): void {
    if (this.profileForm.invalid) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.http.put<{ message: string; user: any }>('/api/auth/profile', this.profileForm.value)
      .subscribe({
        next: (response) => {
          this.user.set(response.user);
          localStorage.setItem('user', JSON.stringify(response.user));
          this.successMessage.set('Profile updated successfully!');
          this.isSubmitting.set(false);
          setTimeout(() => {
            this.closeEditModal();
            this.successMessage.set('');
          }, 1500);
        },
        error: (err) => {
          this.errorMessage.set(err.error?.error || 'Failed to update profile.');
          this.isSubmitting.set(false);
        }
      });
  }

  onChangePassword(): void {
    if (this.passwordForm.invalid) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const { oldPassword, newPassword } = this.passwordForm.value;

    this.http.put<{ message: string }>('/api/auth/change-password', { oldPassword, newPassword })
      .subscribe({
        next: (response) => {
          this.successMessage.set('Password changed successfully!');
          this.isSubmitting.set(false);
          setTimeout(() => {
            this.closePasswordModal();
            this.successMessage.set('');
          }, 1500);
        },
        error: (err) => {
          this.errorMessage.set(err.error?.error || 'Failed to change password.');
          this.isSubmitting.set(false);
        }
      });
  }

  async fetchOrders(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    this.isLoadingOrders.set(true);
    try {
      const ords = await this.checkoutService.getOrderHistory();
      this.orders.set(ords);
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      this.isLoadingOrders.set(false);
    }
  }

  setOrderStatusFilter(filter: string): void {
    this.orderStatusFilter.set(filter);
    this.currentPage.set(1);
  }

  setOrderSearchQuery(query: string): void {
    this.orderSearchQuery.set(query);
    this.currentPage.set(1);
  }

  setOrderSortBy(sortBy: string): void {
    this.orderSortBy.set(sortBy);
    this.currentPage.set(1);
  }

  setCurrentPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  getPagesArray(): number[] {
    const total = this.totalPages();
    const arr = [];
    for (let i = 1; i <= total; i++) {
      arr.push(i);
    }
    return arr;
  }

  getCountByStatus(status: string): number {
    const s = status.toLowerCase();
    return this.orders().filter(o => (o.order_status || '').toLowerCase() === s).length;
  }

  formatOrderDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  getStatusClass(status: string): string {
    const st = (status || '').toLowerCase();
    if (st === 'pending') return 'status--pending';
    if (st === 'processing') return 'status--processing';
    if (st === 'shipping') return 'status--shipping';
    if (st === 'delivered') return 'status--delivered';
    if (st === 'canceled' || st === 'cancelled') return 'status--canceled';
    if (st === 'refund') return 'status--refund';
    return 'status--pending';
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'PENDING',
      processing: 'PROCESSING',
      shipping: 'SHIPPING',
      delivered: 'DELIVERED',
      canceled: 'CANCELED',
      cancelled: 'CANCELED',
      refund: 'REFUNDED'
    };
    return labels[status.toLowerCase()] || status.toUpperCase();
  }

  productThumb(item: any): string {
    return item.image?.url || item.image || '';
  }

  getItemCount(order: any): number {
    if (!order || !order.items) return 0;
    return order.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
  }

  viewOrderDetails(ord: any): void {
    if (!ord) return;

    if (typeof window !== 'undefined') {
      localStorage.setItem('last_order_info', JSON.stringify({
        orderId: ord.order_id,
        sessionId: ord.session_id || ''
      }));
    }

    const status = (ord.order_status || ord.status || '').toLowerCase();
    if (status === 'pending') {
      this.router.navigate(['/checkout/pending'], { state: { order: ord } });
    } else if (status === 'canceled' || status === 'cancelled') {
      this.router.navigate(['/checkout/canceled'], { state: { order: ord } });
    } else if (status === 'processing') {
      this.router.navigate(['/checkout/processing'], { state: { order: ord } });
    } else if (status === 'shipping') {
      this.router.navigate(['/checkout/shipping'], { state: { order: ord } });
    } else if (status === 'delivered') {
      this.router.navigate(['/checkout/delivered'], { state: { order: ord } });
    } else if (status === 'refund') {
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
    } else {
      this.router.navigate(['/checkout/confirmed'], { state: { order: ord, showModal: false } });
    }
  }

  async cancelOrder(ord: any): Promise<void> {
    if (!ord) return;
    if (!confirm('Are you sure you want to cancel this order?')) return;

    this.isLoadingOrders.set(true);
    try {
      const res = await this.checkoutService.cancelOrder(ord.order_id, ord.session_id);
      this.router.navigate(['/checkout/canceled'], { state: { order: res.data } });
    } catch (err: any) {
      console.error('Failed to cancel order:', err);
      alert(err.error?.error || 'Failed to cancel the order. Please try again.');
    } finally {
      this.isLoadingOrders.set(false);
    }
  }

  async buyAgain(ord: any): Promise<void> {
    if (!ord || !ord.items) return;

    try {
      const allProducts = await this.checkoutService.getAllProducts();
      const checkoutItems = ord.items.map((it: any) => {
        const matchingProduct = allProducts.find(p => p._id === it.product_id);
        if (!matchingProduct) return null;
        return {
          product: matchingProduct,
          variantSku: it.variant_id,
          quantity: it.quantity
        };
      }).filter(Boolean);

      if (checkoutItems.length === 0) {
        alert('Products in this order are no longer available.');
        return;
      }

      this.cartService.checkoutSummaryItems.set(checkoutItems);
      localStorage.setItem('checkout_summary_items', JSON.stringify(checkoutItems));
      
      const deliveryInfo = {
        name: ord.delivery_info?.recipient_name || '',
        mobile: ord.delivery_info?.mobile || '',
        email: ord.delivery_info?.email || '',
        city: ord.delivery_info?.city || '',
        address: ord.delivery_info?.address || '',
        note: ord.delivery_info?.note || ''
      };
      localStorage.setItem('checkout_delivery_info', JSON.stringify(deliveryInfo));

      this.cartService.setCheckoutProcessed(true);
      this.router.navigate(['/checkout']);
    } catch (err) {
      console.error('Failed to buy again:', err);
      alert('Failed to load products for checkout. Please try again.');
    }
  }

  async confirmReceipt(ord: any): Promise<void> {
    if (!ord) return;
    if (!confirm('Have you received your package? This will mark the order as delivered.')) return;
    
    this.isLoadingOrders.set(true);
    try {
      const res = await this.checkoutService.receiveOrder(ord.order_id, ord.session_id);
      await this.fetchOrders();
      this.openReviewModal(res.data);
    } catch (err: any) {
      console.error('Failed to mark order as received:', err);
      alert(err.error?.error || 'Failed to update order status. Please try again.');
    } finally {
      this.isLoadingOrders.set(false);
    }
  }

  openReviewModal(order: any): void {
    this.selectedOrderForReview.set(order);
    this.showReviewModal.set(true);
  }

  onReviewOrderUpdated(updatedOrder: any): void {
    this.fetchOrders();
  }

  refundOrder(ord: any): void {
    if (!ord) return;
    this.router.navigate([`/orders/${ord.order_id || ord._id}/return`], { state: { order: ord } });
  }

  openAddressModal(address: any = null): void {
    const addresses = this.user()?.addresses || [];
    this.selectedAddressForEdit.set(address);
    this.isOnlyAddress.set(addresses.length === 0 || (addresses.length === 1 && address));
    this.showAddressModal.set(true);
  }

  closeAddressModal(): void {
    this.showAddressModal.set(false);
    this.selectedAddressForEdit.set(null);
  }

  async onSaveAddress(formData: Omit<UserAddress, '_id'>): Promise<void> {
    this.isLoading.set(true);
    try {
      const editAddress = this.selectedAddressForEdit();
      if (editAddress) {
        await this.checkoutService.updateUserAddress(editAddress._id, formData);
      } else {
        await this.checkoutService.addUserAddress(formData);
      }
      await this.fetchProfile();
      this.closeAddressModal();
    } catch (err: any) {
      console.error('Failed to save address:', err);
      alert(err.error?.error || 'Failed to save address. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  openDeleteAddressModal(address: any): void {
    this.selectedAddressForDelete.set(address);
    this.showDeleteAddressModal.set(true);
  }

  closeDeleteAddressModal(): void {
    this.showDeleteAddressModal.set(false);
    this.selectedAddressForDelete.set(null);
  }

  async confirmDeleteAddress(): Promise<void> {
    const address = this.selectedAddressForDelete();
    if (!address) return;

    this.isLoading.set(true);
    try {
      await this.checkoutService.deleteUserAddress(address._id);
      await this.fetchProfile();
      this.closeDeleteAddressModal();
    } catch (err: any) {
      console.error('Failed to delete address:', err);
      alert(err.error?.error || 'Failed to delete address. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSetAsDefaultAddress(address: any): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.checkoutService.updateUserAddress(address._id, { is_default: true });
      await this.fetchProfile();
    } catch (err: any) {
      console.error('Failed to set address as default:', err);
      alert(err.error?.error || 'Failed to set default address. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  cardCategory = signal<'credit_debit' | 'domestic_atm'>('credit_debit');

  setCardCategory(category: 'credit_debit' | 'domestic_atm'): void {
    this.cardCategory.set(category);
    this.cardForm.card_type = category === 'domestic_atm' ? 'NAPAS' : 'credit';
    this.clearCardErrors();
  }

  clearCardErrors(): void {
    if (this.cardValidator) {
      this.cardValidator.clearAll();
    }
    const type = this.cardForm.card_type;
    this.cardForm = {
      card_type: type,
      card_number: '',
      cardholder_name: '',
      expire_date: '',
      cvc: '',
      issued_bank: '',
      is_default: (this.user()?.payment_methods || []).length === 0
    };
  }

  openAddCardForm(): void {
    this.cardCategory.set('credit_debit');
    this.cardForm = {
      card_type: 'credit',
      card_number: '',
      cardholder_name: '',
      expire_date: '',
      cvc: '',
      issued_bank: '',
      is_default: (this.user()?.payment_methods || []).length === 0
    };
    this.isAddingCard.set(true);
    this.setupCardValidator();
  }

  setupCardValidator(): void {
    setTimeout(() => {
      const cardConfigs: FieldConfig[] = [
        {
          field_id: 'account-card-holder-name',
          error_element_id: 'account-card-holder-name-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'Cardholder name is required.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: 'value.trim().split(/\\s+/).filter(Boolean).length < 2',
              error_message: 'Cardholder name must contain full name (at least 2 words).'
            },
            {
              sequence: 3,
              type: 'FORMAT_CHECK',
              regex_pattern: '[0-9]',
              error_message: 'Cardholder name cannot contain numbers.'
            }
          ]
        },
        {
          field_id: 'account-card-num',
          error_element_id: 'account-card-num-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'Card number is required.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              regex_pattern: '[^0-9\\s]',
              error_message: 'Card number can only contain digits and spaces.'
            },
            {
              sequence: 3,
              type: 'FORMAT_CHECK',
              condition: 'window.validateAccountCardNumberFormat(value, window.getAccountCardType())',
              error_message: 'Invalid card number format for the selected card type.'
            }
          ]
        },
        {
          field_id: 'account-card-expiry',
          error_element_id: 'account-card-expiry-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'Expiry date is required.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: '!/^(0[1-9]|1[0-2])\\s*\\/\\s*\\d{2}$/.test(value.trim())',
              error_message: 'Expiry date must be in MM/YY format.'
            },
            {
              sequence: 3,
              type: 'FORMAT_CHECK',
              condition: 'window.isAccountCardExpiredCheck(value)',
              error_message: 'Card has expired or expiry date is invalid.'
            }
          ]
        },
        {
          field_id: 'account-card-cvc',
          error_element_id: 'account-card-cvc-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              condition: 'window.getAccountCardType() !== "NAPAS" && value.trim() === ""',
              error_message: 'CVV is required.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: 'window.getAccountCardType() !== "NAPAS" && !/^\\d{3}$/.test(value.trim())',
              error_message: 'CVV must be exactly 3 digits.'
            }
          ]
        },
        {
          field_id: 'account-card-bank',
          error_element_id: 'account-card-bank-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              condition: 'window.getAccountCardType() === "NAPAS" && value.trim() === ""',
              error_message: 'Issued bank is required.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: 'window.getAccountCardType() === "NAPAS" && !window.isValidAccountBank(value)',
              error_message: 'Invalid bank name. Please select from the list.'
            }
          ]
        }
      ];

      if (this.cardValidator) {
        this.cardValidator.detach();
      }
      this.cardValidator = new InlineValidator(cardConfigs);
      this.cardValidator.attach();
    }, 100);
  }

  closeAddCardForm(): void {
    this.isAddingCard.set(false);
    if (this.cardValidator) {
      this.cardValidator.detach();
      this.cardValidator = null;
    }
  }

  formatCardholderName(): void {
    if (!this.cardForm.cardholder_name) return;
    if (this.cardValidator && this.cardValidator.validateField('account-card-holder-name')) {
      this.cardForm.cardholder_name = this.cardForm.cardholder_name
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }

  formatCardNumber(): void {
    if (!this.cardForm.card_number) return;
    if (this.cardValidator && this.cardValidator.validateField('account-card-num')) {
      const clean = this.cardForm.card_number.replace(/\s+/g, '');
      const formatted = clean.match(/.{1,4}/g)?.join(' ') || clean;
      this.cardForm.card_number = formatted;
    }
  }

  async submitCardForm(): Promise<void> {
    if (this.cardValidator && !this.cardValidator.validateAll()) {
      return;
    }

    if (!this.cardForm.card_number.trim() ||
      !this.cardForm.cardholder_name.trim() ||
      !this.cardForm.expire_date.trim()) {
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.checkoutService.addUserPaymentMethod({
        ...this.cardForm,
        card_number: this.cardForm.card_number.replace(/\s+/g, '')
      });
      await this.fetchProfile();
      this.closeAddCardForm();
    } catch (err: any) {
      console.error('Failed to add payment card:', err);
      alert(err.error?.error || 'Failed to add payment card. Please try again.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async onDeletePaymentCard(cardId: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this payment card?')) return;

    this.isLoading.set(true);
    try {
      await this.checkoutService.deleteUserPaymentMethod(cardId);
      await this.fetchProfile();
    } catch (err: any) {
      console.error('Failed to delete payment card:', err);
      alert(err.error?.error || 'Failed to delete payment card. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  signOut(): void {
    this.authService.logout();
    this.router.navigate(['/']);
  }
}