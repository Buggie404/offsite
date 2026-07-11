import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, signal, computed, NgZone, ChangeDetectorRef, ViewChild, ElementRef, HostListener } from '@angular/core';
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
import { CompletePaymentModalComponent } from '../../purchase/components/complete-payment-modal/complete-payment-modal.component';
import { PaymentModalComponent } from '../../purchase/components/payment-modal/payment-modal.component';
import { ChangePaymentModalComponent } from '../../purchase/components/change-payment-modal/change-payment-modal.component';
import { InlineValidator, FieldConfig } from '../../../shared/utils/inline-validator';
import { ToastService } from '../../../shared/services/toast.service';
import { QuickViewModalComponent } from '../../shop/components/quick-view-modal/quick-view-modal.component';
import { ConfirmationModalComponent } from '../../../shared/components/confirmation-modal/confirmation-modal.component';
import { Product } from '../../home/models/product.model';

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
  LucideWallet,
  LucidePackageCheck,
  LucideChevronLeft,
  LucideChevronRight,
  LucideTrash2,
  LucidePencil,
  LucideChevronDown,
  LucideChevronUp,
  LucideArrowRight,
  LucideCoffee,
  LucideClock,
  LucideChefHat,
  LucideDroplet,
  LucideChevronsUpDown,
  LucideChevronsDownUp,
  LucideEye,
  LucideEyeOff,
  LucideDessert,
  LucideBadgeCheck
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
    LucideWallet,
    LucideStar,
    LucidePackageCheck,
    LucideChevronLeft,
    LucideChevronRight,
    LucideTrash2,
    LucidePencil,
    ReviewModalComponent,
    AddressModalComponent,
    DeleteAddressModalComponent,
    QuickViewModalComponent,
    CompletePaymentModalComponent,
    PaymentModalComponent,
    ChangePaymentModalComponent,
    ConfirmationModalComponent,
    LucideChevronDown,
    LucideChevronUp,
    LucideArrowRight,
    LucideCoffee,
    LucideClock,
    LucideChefHat,
    LucideDroplet,
    LucideChevronsUpDown,
    LucideChevronsDownUp,
    LucideEye,
    LucideEyeOff,
    LucideDessert,
    LucideBadgeCheck
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
  private zone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);
  private toastService = inject(ToastService);

  // Confirmation Modal state properties
  isConfirmModalOpen = false;
  confirmModalTitle = '';
  confirmModalMessage = '';
  confirmModalWarning = '';
  confirmModalConfirmText = 'Confirm';
  confirmModalCancelText = 'Cancel';
  confirmModalType: 'danger' | 'success' | 'info' = 'info';
  confirmModalAction: (() => Promise<void> | void) | null = null;

  onConfirmModalConfirm(): void {
    this.isConfirmModalOpen = false;
    if (this.confirmModalAction) {
      this.confirmModalAction();
    }
  }

  onConfirmModalCancel(): void {
    this.isConfirmModalOpen = false;
    this.confirmModalAction = null;
  }

  // Profile data signals
  user = signal<any>(null);
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  avatarPreview = signal<string>('');

  // ══════════════ OTP UPDATE PROFILE STATE ══════════════
  @ViewChild('hiddenOtpInput') hiddenOtpInput!: ElementRef<HTMLInputElement>;
  isOtpStep = false;
  otpValue = '';
  otpDigits: string[] = ['', '', '', '', '', ''];
  otpError: string | null = null;
  otpLocked = false;
  readonly OTP_MAX_ATTEMPTS = 3;
  otpAttemptsLeft = this.OTP_MAX_ATTEMPTS;
  otpCountdown = signal(0);
  mockOtp = '';
  private otpTimerHandle: ReturnType<typeof setInterval> | null = null;
  private readonly OTP_DURATION_SECONDS = 2 * 60;
  updateToken = '';
  pendingUpdateData: any = null;
  isVerifyingOtp = false;
  isResendingOtp = false;

  // Saved items signals
  savedProducts = signal<any[]>([]);
  savedRecipes = signal<any[]>([]);
  savedPosts = signal<any[]>([]);
  savedBlogs = signal<any[]>([]);
  isSavedLoading = signal<boolean>(false);
  visibleLimits = signal<Record<string, number>>({
    products: 3,
    recipes: 3,
    posts: 3,
    blogs: 3
  });

  // Collapsible sections
  sectionsExpanded = signal<any>({
    products: true,
    recipes: true,
    posts: true,
    blogs: true
  });

  // Selected arrays for checkboxes
  selectedProducts = signal<string[]>([]);
  selectedRecipes = signal<string[]>([]);
  selectedPosts = signal<string[]>([]);
  selectedBlogs = signal<string[]>([]);

  // Tab & Modal State
  activeTab = signal<string>('profile');
  savedMinHeight = signal<string>('auto');
  showEditModal = signal<boolean>(false);
  
  // Change Contact Info Modal state properties
  showChangeContactModal = signal<boolean>(false);
  changeContactType = signal<'email' | 'phone'>('email');
  newContactValue = signal<string>('');
  isChangeOtpStep = signal<boolean>(false);
  changeOtpValue = signal<string>('');
  changeOtpDigits = signal<string[]>(['', '', '', '', '', '']);
  changeOtpError = signal<string | null>(null);
  changeOtpLocked = signal<boolean>(false);
  changeOtpAttemptsLeft = signal<number>(3);
  isSendingChangeOtp = signal<boolean>(false);
  isVerifyingChangeOtp = signal<boolean>(false);
  changeOtpCountdown = signal<number>(0);
  changeOtpMock = signal<string>('');
  changeMaskedContact = signal<string>('');
  private changeOtpTimerHandle: any = null;
  private readonly CHANGE_OTP_DURATION = 2 * 60;

  @ViewChild('hiddenChangeOtpInput') hiddenChangeOtpInput!: ElementRef<HTMLInputElement>;

  showPasswordModal = signal<boolean>(false);
  showOldPassword = signal<boolean>(false);
  showNewPassword = signal<boolean>(false);
  showConfirmPassword = signal<boolean>(false);
  isSidebarOpen = signal<boolean>(false);
  showDeleteSelectedModal = signal<boolean>(false);
  deleteSelectedSection = signal<string>('');
  selectedQuickViewProduct = signal<Product | null>(null);

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
  showDeleteCardModal = signal<boolean>(false);
  selectedCardForDelete = signal<string | null>(null);
  
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

  // Payment Modal State
  selectedOrderForPayment = signal<any>(null);
  showCompletePaymentModal = signal<boolean>(false);
  showPaymentModal = signal<boolean>(false);
  showChangePaymentModal = signal<boolean>(false);

  // Tracking Modal State
  showTrackingModal = signal<boolean>(false);
  activeTrackingCode = signal<string>('');

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
      if (filter === 'refund') {
        list = list.filter(o => {
          const s = (o.order_status || '').toLowerCase();
          return s === 'refund' || s === 'pending_refund' || s === 'refund_rejected';
        });
      } else {
        list = list.filter(o => (o.order_status || '').toLowerCase() === filter);
      }
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
        if (params['tab'] === 'saved') {
          if (typeof window !== 'undefined') {
            const lastScrollY = sessionStorage.getItem('lastScrollY');
            if (lastScrollY) {
              const y = parseInt(lastScrollY, 10);
              this.savedMinHeight.set((y + window.innerHeight) + 'px');
              
              // Restore scroll position multiple times to prevent layout shifts/resets
              window.scrollTo(0, y);
              setTimeout(() => {
                window.scrollTo(0, y);
              }, 50);
              setTimeout(() => {
                window.scrollTo(0, y);
              }, 150);
              setTimeout(() => {
                window.scrollTo(0, y);
              }, 300);
            }
          }
          this.fetchSavedItems();
        } else {
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('lastScrollY');
          }
        }
      } else {
        if (this.activeTab() === 'saved') {
          this.fetchSavedItems();
        }
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
    this.clearChangeOtpCountdown();
    if (this.cardValidator) {
      this.cardValidator.detach();
      this.cardValidator = null;
    }
    if (this.profileValidator) {
      this.profileValidator.detach();
      this.profileValidator = null;
    }
    if (this.passwordValidator) {
      this.passwordValidator.detach();
      this.passwordValidator = null;
    }
    if (typeof window !== 'undefined') {
      delete (window as any).getAccountCardType;
      delete (window as any).validateAccountCardNumberFormat;
      delete (window as any).isAccountCardExpiredCheck;
      delete (window as any).isValidAccountBank;

      // Save scroll position when leaving Saved items tab
      if (this.activeTab() === 'saved') {
        sessionStorage.setItem('lastScrollY', window.scrollY.toString());
      }
    }
  }

  // 1. Tùy chỉnh Validators cho Form
  private initForms(): void {
    this.profileForm = this.fb.group({
      profile_name: ['', [Validators.required, Validators.minLength(2)]],
      community_name: ['', [Validators.minLength(2)]],
      email: ['', [Validators.email]],
      phone: ['', [Validators.pattern(/^([0-9]{10,11})?$/)]],
      avatar_url: ['']
    }, { validators: this.atLeastOneContactValidator });

    this.profileForm.valueChanges.subscribe(() => {
      if (this.errorMessage()) {
        this.errorMessage.set('');
      }
    });

    this.passwordForm = this.fb.group({
      oldPassword: ['', [Validators.required, Validators.minLength(8)]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  // Bắt buộc phải điền Email HOẶC Phone (1 trong 2)
  private atLeastOneContactValidator = (g: FormGroup) => {
    const email = g.get('email')?.value;
    const phone = g.get('phone')?.value;
    if ((!email || email.trim() === '') && (!phone || phone.trim() === '')) {
      return { atLeastOneContact: true };
    }
    return null;
  }

  profileValidator: InlineValidator | null = null;

  // 2. Chỉnh sửa logic hiển thị lỗi của Vanilla JS validator
  setupProfileValidator(): void {
    setTimeout(() => {
      const profileConfigs: FieldConfig[] = [
        {
          field_id: 'profile_name',
          error_element_id: 'profile_name-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'Name is required.'
            },
            {
              sequence: 2,
              type: 'LENGTH_CHECK',
              min_length: 2,
              error_message: 'Name must be at least 2 characters long.'
            }
          ]
        },
        {
          field_id: 'community_name',
          error_element_id: 'community_name-error',
          rules: [
            {
              sequence: 1,
              type: 'LENGTH_CHECK',
              min_length: 2,
              error_message: 'Community name must be at least 2 characters long.'
            }
          ]
        },
        {
          field_id: 'email',
          error_element_id: 'email-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              condition: 'value.trim() !== "" && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(value.trim())',
              error_message: 'Invalid email format.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: 'value.trim() === "" && (document.getElementById("phone") ? document.getElementById("phone").value.trim() === "" : true)',
              error_message: 'Either email or phone is required.'
            }
          ]
        },
        {
          field_id: 'phone',
          error_element_id: 'phone-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              condition: 'value.trim() !== "" && !/^[0-9]{10,11}$/.test(value.trim())',
              error_message: 'Phone number must be 10-11 digits.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: 'value.trim() === "" && (document.getElementById("email") ? document.getElementById("email").value.trim() === "" : true)',
              error_message: 'Either email or phone is required.'
            }
          ]
        }
      ];

      if (this.profileValidator) {
        this.profileValidator.detach();
      }
      this.profileValidator = new InlineValidator(profileConfigs);
      this.profileValidator.attach();
    }, 100);
  }

  // 3. Tối ưu hàm lấy lỗi cho Reactive Form
  getFieldError(field: string): string | null {
    const control = this.profileForm.get(field);
    if (!control) {
      return null;
    }

    // Check backend errors FIRST (bypasses dirty/touched check)
    const errorMsg = this.errorMessage();
    if (errorMsg) {
      if (field === 'email' && (errorMsg.includes('email') || errorMsg.includes('Email') || errorMsg.includes('thư điện tử'))) {
        return 'Email already in use';
      }
      if (field === 'phone' && (errorMsg.includes('phone') || errorMsg.includes('Phone') || errorMsg.includes('số điện thoại') || errorMsg.includes('Số điện thoại'))) {
        return 'Phone number already in use';
      }
      if (field === 'community_name' && (errorMsg.includes('community') || errorMsg.includes('Community') || errorMsg.includes('cộng đồng') || errorMsg.includes('Cộng đồng'))) {
        return 'Community name already in use';
      }
    }

    if (!(control.dirty || control.touched)) {
      return null;
    }

    if (control.invalid || this.profileForm.errors?.['atLeastOneContact']) {
      if (control.errors?.['required']) {
        if (field === 'profile_name') return 'Name is required';
      }
      if (control.errors?.['minlength']) {
        if (field === 'profile_name') return 'Name must be at least 2 characters long';
        if (field === 'community_name') return 'Community name must be at least 2 characters long';
      }
      if (control.errors?.['email']) {
        return 'Invalid email format';
      }
      if (control.errors?.['pattern']) {
        if (field === 'phone') return 'Phone number must be 10-11 digits';
      }
      if (this.profileForm.errors?.['atLeastOneContact']) {
         if (field === 'email' || field === 'phone') return 'Either email or phone is required';
      }
      if (control.invalid) {
         return 'Invalid input';
      }
    }

    return null;
  }

  hasFieldError(field: string): boolean {
    return this.getFieldError(field) !== null;
  }

  // 4. Update hiển thị tick xanh (Chỉ hiện khi field đó có điền text)
  hasFieldSuccess(field: string): boolean {
    if (field === 'community_name') {
      return false;
    }
    const control = this.profileForm.get(field);
    if (!control || !(control.dirty || control.touched)) {
      return false;
    }
    
    // For optional fields, only show success if they have entered a value
    if (field === 'email' || field === 'phone') {
      if (!control.value || control.value.trim() === '') {
        return false;
      }
    }

    if (typeof document !== 'undefined') {
      const inputEl = document.getElementById(field);
      if (inputEl && inputEl.classList.contains('invalid')) {
        return false;
      }
    }

    // If there is any field-specific backend error, it's not a success
    const errorMsg = this.errorMessage();
    if (errorMsg) {
      if (field === 'email' && (errorMsg.includes('email') || errorMsg.includes('Email') || errorMsg.includes('thư điện tử'))) {
        return false;
      }
      if (field === 'phone' && (errorMsg.includes('phone') || errorMsg.includes('Phone') || errorMsg.includes('số điện thoại') || errorMsg.includes('Số điện thoại'))) {
        return false;
      }
      if (field === 'community_name' && (errorMsg.includes('community') || errorMsg.includes('Community') || errorMsg.includes('cộng đồng') || errorMsg.includes('Cộng đồng'))) {
        return false;
      }
    }

    return control.valid && !this.profileForm.errors?.['atLeastOneContact'];
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
          if (err.status === 401 || err.status === 403) {
            this.signOut();
          }
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
    
    // Sync tab to query parameters so back button restores it
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab },
      queryParamsHandling: 'merge'
    });

    if (tab === 'saved') {
      this.fetchSavedItems();
    }
  }

  saveScrollAnchor(type: string, id: string | number): void {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('lastSavedAnchor', `${type}-${id}`);
      sessionStorage.setItem('lastScrollY', window.scrollY.toString());
    }
  }

  fetchSavedItems(showOverlay = true): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (showOverlay) {
      this.isSavedLoading.set(true);
    }
    this.http.get<any>('/api/auth/saved-items').subscribe({
      next: (res) => {
        const sortBySavedAtDesc = (arr: any[]) => {
          return [...arr].sort((a, b) => new Date(b.saved_at || 0).getTime() - new Date(a.saved_at || 0).getTime());
        };

        this.savedProducts.set(sortBySavedAtDesc(res.saved_products || []));
        this.savedRecipes.set(sortBySavedAtDesc(res.saved_recipes || []));
        this.savedPosts.set(sortBySavedAtDesc(res.saved_posts || []));
        this.savedBlogs.set(sortBySavedAtDesc(res.saved_blogs || []));
        if (showOverlay) {
          this.isSavedLoading.set(false);
        }

        // Reset limits and selections only on full reload overlay
        if (showOverlay) {
          this.visibleLimits.set({
            products: 3,
            recipes: 3,
            posts: 3,
            blogs: 3
          });

          this.selectedProducts.set([]);
          this.selectedRecipes.set([]);
          this.selectedPosts.set([]);
          this.selectedBlogs.set([]);
        }

        // Restore scroll position to the exact previous coordinates instantly
        const hasAnyItems = this.savedProducts().length > 0 || this.savedRecipes().length > 0 ||
                           this.savedPosts().length > 0 || this.savedBlogs().length > 0;
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            if (!hasAnyItems) {
              // No items left, scroll to top of saved tab
              const contentPanel = document.querySelector('.content-panel') as HTMLElement;
              if (contentPanel) {
                const headerHeight = 160;
                window.scrollTo({ top: contentPanel.offsetTop - headerHeight, behavior: 'auto' });
              }
            } else {
              const lastScrollY = sessionStorage.getItem('lastScrollY');
              if (lastScrollY) {
                window.scrollTo(0, parseInt(lastScrollY, 10));
                sessionStorage.removeItem('lastScrollY');
                sessionStorage.removeItem('lastSavedAnchor');
              } else {
                const anchorId = sessionStorage.getItem('lastSavedAnchor');
                if (anchorId) {
                  const element = document.getElementById(anchorId);
                  if (element) {
                    element.scrollIntoView({ behavior: 'auto', block: 'center' });
                  }
                  sessionStorage.removeItem('lastSavedAnchor');
                }
              }
            }
            // Reset min-height back to auto now that real content is rendered
            setTimeout(() => {
              this.savedMinHeight.set('auto');
            }, 50);
          }
        }, 100);
      },
      error: (err) => {
        console.error('Failed to fetch saved items:', err);
        if (showOverlay) {
          this.isSavedLoading.set(false);
        }
      }
    });
  }

  toggleSection(section: string): void {
    const current = this.sectionsExpanded();
    this.sectionsExpanded.set({
      ...current,
      [section]: !current[section]
    });
  }

  toggleCollapseAll(): void {
    const current = this.sectionsExpanded();
    const anyExpanded = Object.values(current).some(v => v);
    this.sectionsExpanded.set({
      products: !anyExpanded,
      recipes: !anyExpanded,
      posts: !anyExpanded,
      blogs: !anyExpanded
    });
  }

  isAllExpanded(): boolean {
    const current = this.sectionsExpanded();
    return Object.values(current).every(v => v);
  }

  toggleSelection(section: string, id: string): void {
    if (section === 'products') {
      const current = this.selectedProducts();
      this.selectedProducts.set(current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
    } else if (section === 'recipes') {
      const current = this.selectedRecipes();
      this.selectedRecipes.set(current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
    } else if (section === 'posts') {
      const current = this.selectedPosts();
      this.selectedPosts.set(current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
    } else if (section === 'blogs') {
      const current = this.selectedBlogs();
      this.selectedBlogs.set(current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
    }
  }

  isItemSelected(section: string, id: string): boolean {
    if (section === 'products') return this.selectedProducts().includes(id);
    if (section === 'recipes') return this.selectedRecipes().includes(id);
    if (section === 'posts') return this.selectedPosts().includes(id);
    if (section === 'blogs') return this.selectedBlogs().includes(id);
    return false;
  }

  isAllSelected(section: string): boolean {
    if (section === 'products') {
      const total = this.savedProducts().length;
      return total > 0 && this.selectedProducts().length === total;
    }
    if (section === 'recipes') {
      const total = this.savedRecipes().length;
      return total > 0 && this.selectedRecipes().length === total;
    }
    if (section === 'posts') {
      const total = this.savedPosts().length;
      return total > 0 && this.selectedPosts().length === total;
    }
    if (section === 'blogs') {
      const total = this.savedBlogs().length;
      return total > 0 && this.selectedBlogs().length === total;
    }
    return false;
  }

  toggleSelectAll(section: string): void {
    if (section === 'products') {
      if (this.isAllSelected(section)) {
        this.selectedProducts.set([]);
      } else {
        this.selectedProducts.set(this.savedProducts().map(item => item.product.product_id.toString()));
      }
    } else if (section === 'recipes') {
      if (this.isAllSelected(section)) {
        this.selectedRecipes.set([]);
      } else {
        this.selectedRecipes.set(this.savedRecipes().map(item => item.recipe.recipe_id));
      }
    } else if (section === 'posts') {
      if (this.isAllSelected(section)) {
        this.selectedPosts.set([]);
      } else {
        this.selectedPosts.set(this.savedPosts().map(item => item.post.post_id));
      }
    } else if (section === 'blogs') {
      if (this.isAllSelected(section)) {
        this.selectedBlogs.set([]);
      } else {
        this.selectedBlogs.set(this.savedBlogs().map(item => item.blog._id));
      }
    }
  }

  removeItem(section: string, id: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    let endpoint = '';
    let body = {};
    if (section === 'products') {
      endpoint = '/api/auth/saved-products';
      body = { productId: id };
    } else if (section === 'recipes') {
      endpoint = '/api/auth/saved-recipes';
      body = { recipeId: id };
    } else if (section === 'posts') {
      endpoint = '/api/auth/saved-posts';
      body = { postId: id };
    } else if (section === 'blogs') {
      endpoint = '/api/auth/saved-blogs';
      body = { blogId: id };
    }

    if (endpoint) {
      // Optimistically update signals for smooth/instant removal
      const previousProducts = this.savedProducts();
      const previousRecipes = this.savedRecipes();
      const previousPosts = this.savedPosts();
      const previousBlogs = this.savedBlogs();

      if (section === 'products') {
        this.savedProducts.set(previousProducts.filter(item => item.product.product_id.toString() !== id));
        this.selectedProducts.set(this.selectedProducts().filter(x => x !== id));
      } else if (section === 'recipes') {
        this.savedRecipes.set(previousRecipes.filter(item => item.recipe.recipe_id !== id));
        this.selectedRecipes.set(this.selectedRecipes().filter(x => x !== id));
      } else if (section === 'posts') {
        this.savedPosts.set(previousPosts.filter(item => item.post.post_id !== id));
        this.selectedPosts.set(this.selectedPosts().filter(x => x !== id));
      } else if (section === 'blogs') {
        this.savedBlogs.set(previousBlogs.filter(item => item.blog._id !== id));
        this.selectedBlogs.set(this.selectedBlogs().filter(x => x !== id));
      }

      this.http.post(endpoint, body).subscribe({
        next: () => this.fetchSavedItems(false),
        error: (err) => {
          console.error(`Failed to remove item from ${section}:`, err);
          // Revert optimistic updates
          this.savedProducts.set(previousProducts);
          this.savedRecipes.set(previousRecipes);
          this.savedPosts.set(previousPosts);
          this.savedBlogs.set(previousBlogs);
          this.fetchSavedItems(true);
        }
      });
    }
  }

  deleteSelected(section: string): void {
    let selectedIds: string[] = [];
    if (section === 'products') selectedIds = this.selectedProducts();
    if (section === 'recipes') selectedIds = this.selectedRecipes();
    if (section === 'posts') selectedIds = this.selectedPosts();
    if (section === 'blogs') selectedIds = this.selectedBlogs();

    if (selectedIds.length === 0) return;

    this.deleteSelectedSection.set(section);
    this.showDeleteSelectedModal.set(true);
  }

  confirmDeleteSelected(): void {
    const section = this.deleteSelectedSection();
    if (!section) return;

    if (!isPlatformBrowser(this.platformId)) return;

    // Capture IDs and section BEFORE closing modal
    const selectedIds = this.getSelectedIdsForSection(section);
    if (selectedIds.length === 0) {
      this.closeDeleteSelectedModal();
      return;
    }

    // Map section to backend type
    const typeMap: { [key: string]: string } = {
      products: 'products',
      recipes: 'recipes',
      posts: 'posts',
      blogs: 'blogs'
    };

    const type = typeMap[section];

    // Optimistically update signals for smooth/instant removal
    const previousProducts = this.savedProducts();
    const previousRecipes = this.savedRecipes();
    const previousPosts = this.savedPosts();
    const previousBlogs = this.savedBlogs();

    // Optimistically remove items
    this.applyOptimisticRemoval(section, selectedIds, previousProducts, previousRecipes, previousPosts, previousBlogs);

    // Close modal AFTER capturing all data
    this.closeDeleteSelectedModal();

    // Use batch delete endpoint for atomic operation
    this.http.post<any>('/api/auth/saved-items-batch-delete', { type, ids: selectedIds })
      .subscribe({
        next: () => {
          // Clear scroll position so it won't restore to old position
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('lastScrollY');
            sessionStorage.removeItem('lastSavedAnchor');
          }
          this.fetchSavedItems(false);
        },
        error: (err) => {
          console.error(`Failed to delete selected items from ${section}:`, err);
          // Revert optimistic updates
          this.savedProducts.set(previousProducts);
          this.savedRecipes.set(previousRecipes);
          this.savedPosts.set(previousPosts);
          this.savedBlogs.set(previousBlogs);
          this.fetchSavedItems(true);
        }
      });
  }

  private getSelectedIdsForSection(section: string): string[] {
    if (section === 'products') return this.selectedProducts();
    if (section === 'recipes') return this.selectedRecipes();
    if (section === 'posts') return this.selectedPosts();
    if (section === 'blogs') return this.selectedBlogs();
    return [];
  }

  private applyOptimisticRemoval(section: string, selectedIds: string[], previousProducts: any[], previousRecipes: any[], previousPosts: any[], previousBlogs: any[]): void {
    if (section === 'products') {
      this.savedProducts.set(previousProducts.filter(item => !selectedIds.includes(item.product.product_id.toString())));
      this.selectedProducts.set([]);
    } else if (section === 'recipes') {
      this.savedRecipes.set(previousRecipes.filter(item => !selectedIds.includes(item.recipe.recipe_id)));
      this.selectedRecipes.set([]);
    } else if (section === 'posts') {
      this.savedPosts.set(previousPosts.filter(item => !selectedIds.includes(item.post.post_id)));
      this.selectedPosts.set([]);
    } else if (section === 'blogs') {
      this.savedBlogs.set(previousBlogs.filter(item => !selectedIds.includes(item.blog._id)));
      this.selectedBlogs.set([]);
    }
  }

  closeDeleteSelectedModal(): void {
    this.showDeleteSelectedModal.set(false);
    this.deleteSelectedSection.set('');
  }

  addProductToCart(product: any): void {
    this.cartService.addToCart(product);
  }

  openQuickView(product: Product, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedQuickViewProduct.set(product);
  }

  closeQuickView(): void {
    this.selectedQuickViewProduct.set(null);
  }

  onQuickViewSaveToggle(product: Product): void {
    this.removeItem('products', product.product_id.toString());
    this.closeQuickView();
  }

  hasAnySavedItems(): boolean {
    return this.savedProducts().length > 0 ||
           this.savedRecipes().length > 0 ||
           this.savedPosts().length > 0 ||
           this.savedBlogs().length > 0;
  }

  onImgError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/images/logo-mark-dark.svg';
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

  originalProfileValues: any = null;

  openEditModal(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.isOtpStep = false; // Reset flow state
    if (this.user()) {
      const userData = {
        profile_name: this.user().profile_name || '',
        community_name: this.user().community_name || '',
        email: this.user().email || '',
        phone: this.user().phone || '',
        avatar_url: this.user().avatar_url || ''
      };
      this.originalProfileValues = { ...userData };
      this.profileForm.patchValue(userData);
      this.avatarPreview.set(this.user().avatar_url || '');
    }
    this.showEditModal.set(true);
    this.setupProfileValidator();
  }

  hasUnsavedChanges(): boolean {
    if (!this.originalProfileValues) return false;
    const currentValues = this.profileForm.value;
    const currentAvatar = this.avatarPreview();
    
    const nameChanged = (currentValues.profile_name || '') !== (this.originalProfileValues.profile_name || '');
    const communityNameChanged = (currentValues.community_name || '') !== (this.originalProfileValues.community_name || '');
    const emailChanged = (currentValues.email || '') !== (this.originalProfileValues.email || '');
    const phoneChanged = (currentValues.phone || '') !== (this.originalProfileValues.phone || '');
    const avatarChanged = (currentAvatar || '') !== (this.originalProfileValues.avatar_url || '');
    
    return nameChanged || communityNameChanged || emailChanged || phoneChanged || avatarChanged;
  }

  handleCloseEditModal(): void {
    if (this.hasUnsavedChanges()) {
      this.confirmModalTitle = 'Unsaved Changes';
      this.confirmModalMessage = 'You have unsaved changes. Are you sure you want to discard them?';
      this.confirmModalWarning = 'Any changes you made will not be saved.';
      this.confirmModalConfirmText = 'Discard Changes';
      this.confirmModalCancelText = 'Keep Editing';
      this.confirmModalType = 'danger';
      this.confirmModalAction = () => {
        this.closeEditModal();
      };
      this.isConfirmModalOpen = true;
    } else {
      this.closeEditModal();
    }
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    if (this.profileValidator) {
      this.profileValidator.detach();
      this.profileValidator = null;
    }
    this.profileForm.reset();
    this.avatarPreview.set('');
    this.originalProfileValues = null;
  }

  trackByFn(index: number): number {
    return index;
  }

  openChangeModal(type: 'email' | 'phone'): void {
    this.changeContactType.set(type);
    this.newContactValue.set('');
    this.isChangeOtpStep.set(false);
    this.changeOtpValue.set('');
    this.changeOtpDigits.set(['', '', '', '', '', '']);
    this.changeOtpError.set(null);
    this.changeOtpLocked.set(false);
    this.changeOtpAttemptsLeft.set(3);
    this.isSendingChangeOtp.set(false);
    this.isVerifyingChangeOtp.set(false);
    this.changeOtpMock.set('');
    this.changeMaskedContact.set('');
    this.clearChangeOtpCountdown();
    this.showChangeContactModal.set(true);
  }

  closeChangeModal(): void {
    this.showChangeContactModal.set(false);
    this.clearChangeOtpCountdown();
  }

  focusHiddenChangeInput(): void {
    if (this.hiddenChangeOtpInput?.nativeElement) {
      this.hiddenChangeOtpInput.nativeElement.focus();
    }
  }

  onHiddenChangeOtpInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let val = input.value.replace(/\D/g, '');
    if (val.length > 6) {
      val = val.substring(0, 6);
    }
    this.changeOtpValue.set(val);
    input.value = val;

    const digits = ['', '', '', '', '', ''];
    for (let i = 0; i < 6; i++) {
      digits[i] = val[i] || '';
    }
    this.changeOtpDigits.set(digits);
    this.cdr.detectChanges();

    if (val.length === 6) {
      this.verifyChangeOtp();
    }
  }

  get canResendChangeOtp(): boolean {
    return this.changeOtpCountdown() <= 0;
  }

  get changeOtpCountdownLabel(): string {
    const min = Math.floor(this.changeOtpCountdown() / 60);
    const sec = this.changeOtpCountdown() % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  }

  startChangeOtpCountdown(seconds: number): void {
    this.clearChangeOtpCountdown();
    this.changeOtpCountdown.set(seconds);
    this.changeOtpTimerHandle = setInterval(() => {
      this.changeOtpCountdown.update(v => v - 1);
      if (this.changeOtpCountdown() <= 0) {
        this.changeOtpCountdown.set(0);
        this.clearChangeOtpCountdown();
      }
      this.cdr.detectChanges();
    }, 1000);
  }

  clearChangeOtpCountdown(): void {
    if (this.changeOtpTimerHandle) {
      clearInterval(this.changeOtpTimerHandle);
      this.changeOtpTimerHandle = null;
    }
  }

  onContactValueChange(value: string): void {
    this.newContactValue.set(value);
    const val = value.trim();

    if (!val) {
      this.changeOtpError.set(this.changeContactType() === 'email' ? 'Email is required.' : 'Phone number is required.');
      return;
    }

    if (this.changeContactType() === 'email') {
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val)) {
        this.changeOtpError.set('Invalid email format.');
      } else {
        this.changeOtpError.set(null);
      }
    } else {
      if (!/^[0-9]{10,11}$/.test(val)) {
        this.changeOtpError.set('Phone number must be 10-11 digits.');
      } else {
        this.changeOtpError.set(null);
      }
    }
  }

  sendChangeOtp(): void {
    this.onContactValueChange(this.newContactValue());
    if (this.changeOtpError()) {
      return;
    }
    const val = this.newContactValue().trim();
    this.isSendingChangeOtp.set(true);

    this.http.post<any>('/api/auth/send-profile-otp', {
      type: this.changeContactType(),
      value: val
    }).subscribe({
      next: (res) => {
        this.isSendingChangeOtp.set(false);
        this.changeMaskedContact.set(res.maskedContact || '');
        this.changeOtpMock.set(res.__mock || '');
        this.isChangeOtpStep.set(true);
        this.changeOtpValue.set('');
        this.changeOtpDigits.set(['', '', '', '', '', '']);
        this.startChangeOtpCountdown(this.CHANGE_OTP_DURATION);
        this.cdr.detectChanges();
        setTimeout(() => this.focusHiddenChangeInput(), 50);
      },
      error: (err) => {
        this.isSendingChangeOtp.set(false);
        this.changeOtpError.set(err.error?.error || 'Failed to send OTP.');
      }
    });
  }

  resendChangeOtp(): void {
    if (!this.canResendChangeOtp) return;
    this.sendChangeOtp();
  }

  verifyChangeOtp(): void {
    if (this.isVerifyingChangeOtp() || this.changeOtpLocked()) return;
    if (this.changeOtpValue().length !== 6) return;

    this.changeOtpError.set(null);
    this.isVerifyingChangeOtp.set(true);

    this.http.post<any>('/api/auth/verify-profile-otp', {
      type: this.changeContactType(),
      value: this.newContactValue().trim(),
      otp: this.changeOtpValue()
    }).subscribe({
      next: (res) => {
        this.isVerifyingChangeOtp.set(false);
        this.clearChangeOtpCountdown();
        
        // Sync values in profileForm and mark dirty/touched
        const fieldType = this.changeContactType();
        const newVal = this.newContactValue().trim();
        
        this.profileForm.patchValue({
          [fieldType]: newVal
        });
        
        const ctrl = this.profileForm.get(fieldType);
        if (ctrl) {
          ctrl.markAsDirty();
          ctrl.markAsTouched();
        }

        this.toastService.success(`${fieldType === 'email' ? 'Email' : 'Phone number'} verified successfully!`);
        this.closeChangeModal();
      },
      error: (err) => {
        this.isVerifyingChangeOtp.set(false);
        const errMsg = err.error?.error || 'Verification failed.';
        this.changeOtpError.set(errMsg);
        
        // Reset otp fields
        this.changeOtpValue.set('');
        this.changeOtpDigits.set(['', '', '', '', '', '']);
        if (this.hiddenChangeOtpInput?.nativeElement) {
          this.hiddenChangeOtpInput.nativeElement.value = '';
        }

        if (err.error?.remainingAttempts !== undefined) {
          this.changeOtpAttemptsLeft.set(err.error.remainingAttempts);
          if (err.error.remainingAttempts <= 0) {
            this.changeOtpLocked.set(true);
          }
        } else if (err.error?.code === 'OTP_LOCKED') {
          this.changeOtpLocked.set(true);
        }
      }
    });
  }

  onAvatarSelected(event: any): void {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const targetSize = 150;
          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, targetSize, targetSize);
            const base64String = canvas.toDataURL('image/jpeg', 0.7);
            
            this.zone.run(() => {
              this.profileForm.patchValue({
                avatar_url: base64String
              });
              this.avatarPreview.set(base64String);
              this.cdr.detectChanges();
            });
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  removeAvatar(): void {
    this.avatarPreview.set('');
    this.profileForm.patchValue({
      avatar_url: ''
    });
  }

  openPasswordModal(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.showOldPassword.set(false);
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);
    this.showPasswordModal.set(true);
    this.setupPasswordValidator();
  }

  closePasswordModal(): void {
    this.showPasswordModal.set(false);
    if (this.passwordValidator) {
      this.passwordValidator.detach();
      this.passwordValidator = null;
    }
    this.passwordForm.reset();
  }

  passwordValidator: InlineValidator | null = null;

  setupPasswordValidator(): void {
    setTimeout(() => {
      const passwordConfigs: FieldConfig[] = [
        {
          field_id: 'oldPassword',
          error_element_id: 'oldPassword-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'Current password is required.'
            }
          ]
        },
        {
          field_id: 'newPassword',
          error_element_id: 'newPassword-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'New password is required.'
            },
            {
              sequence: 2,
              type: 'LENGTH_CHECK',
              min_length: 8,
              max_length: 15,
              error_message: 'Password must be 8-15 characters.'
            },
            {
              sequence: 3,
              type: 'FORMAT_CHECK',
              regex_pattern: '\\s',
              error_message: 'Password cannot contain spaces.'
            }
          ]
        },
        {
          field_id: 'confirmPassword',
          error_element_id: 'confirmPassword-error',
          rules: [
            {
              sequence: 1,
              type: 'FORMAT_CHECK',
              regex_pattern: '^\\s*$',
              error_message: 'Confirm password is required.'
            },
            {
              sequence: 2,
              type: 'FORMAT_CHECK',
              condition: 'value !== document.getElementById("newPassword")?.value',
              error_message: 'Passwords do not match.'
            }
          ]
        }
      ];

      if (this.passwordValidator) {
        this.passwordValidator.detach();
      }
      this.passwordValidator = new InlineValidator(passwordConfigs);
      this.passwordValidator.attach();
    }, 100);
  }

  toggleOldPasswordVisibility(): void {
    this.showOldPassword.set(!this.showOldPassword());
  }

  toggleNewPasswordVisibility(): void {
    this.showNewPassword.set(!this.showNewPassword());
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.set(!this.showConfirmPassword());
  }

  get newPasswordStrengthScore(): number {
    const p = this.passwordForm.get('newPassword')?.value || '';
    if (!p) return 0;

    const hasLower = /[a-z]/.test(p);
    const hasUpper = /[A-Z]/.test(p);
    const hasDigit = /[0-9]/.test(p);
    const hasSpecial = /[^A-Za-z0-9]/.test(p);

    const groupsCount = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);

    if (p.length < 8) {
      return 1;
    }
    if (p.length >= 10 && groupsCount >= 3) {
      return 3;
    }
    if (groupsCount >= 2) {
      return 2;
    }
    return 1;
  }

  get newPasswordStrengthLabel(): string {
    const score = this.newPasswordStrengthScore;
    if (score === 3) return 'STRONG';
    if (score === 2) return 'MEDIUM';
    if (score === 1) return 'WEAK';
    return '';
  }

  onUpdateProfile(): void {
    if (this.profileForm.invalid) return;
    if (this.profileValidator && !this.profileValidator.validateAll()) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const formValue = this.profileForm.value;

    this.http.put<{ message: string; user: any }>('/api/auth/profile', formValue)
      .subscribe({
        next: (response) => {
          this.zone.run(() => {
            this.isSubmitting.set(false);
            this.user.set(response.user);
            if (typeof window !== 'undefined') {
              localStorage.setItem('user', JSON.stringify(response.user));
            }
            this.toastService.success('Profile updated successfully!');
            this.closeEditModal();
          });
        },
        error: (err) => {
          this.zone.run(() => {
            this.isSubmitting.set(false);
            const errMsg = err.error?.error || 'Failed to update profile.';
            
            // Reopen edit modal if it was closed (but now we don't close it until success)
            this.errorMessage.set(errMsg);

            // Check if the error message is field-specific (email, phone, community name)
            const isFieldSpecific = 
              errMsg.toLowerCase().includes('email') || 
              errMsg.toLowerCase().includes('phone') || 
              errMsg.toLowerCase().includes('số điện thoại') || 
              errMsg.toLowerCase().includes('cộng đồng') || 
              errMsg.toLowerCase().includes('community');

            // If it is NOT a field-specific duplicate error, show a toast error
            if (!isFieldSpecific) {
              this.toastService.error(`Update failed: ${errMsg}`);
            }
          });
        }
      });
  }

  onChangePassword(): void {
    if (this.passwordValidator && !this.passwordValidator.validateAll()) return;

    this.errorMessage.set('');
    this.successMessage.set('');
    this.isSubmitting.set(true);

    const { oldPassword, newPassword } = this.passwordForm.value;

    this.http.put<{ message: string }>('/api/auth/change-password', { oldPassword, newPassword })
      .subscribe({
        next: (response) => {
          this.zone.run(() => {
            this.isSubmitting.set(false);
            this.toastService.success('Password changed successfully!');
            this.closePasswordModal();
          });
        },
        error: (err) => {
          this.zone.run(() => {
            this.isSubmitting.set(false);
            const errMsg = err.error?.error || 'Failed to change password.';

            // Display the specific error inline
            setTimeout(() => {
              if (errMsg.includes('Mật khẩu cũ không chính xác') || errMsg.toLowerCase().includes('incorrect') || errMsg.toLowerCase().includes('cũ không chính xác')) {
                const inputEl = document.getElementById('oldPassword');
                if (inputEl) inputEl.classList.add('invalid');
                const errorEl = document.getElementById('oldPassword-error');
                if (errorEl) {
                  errorEl.textContent = 'Current password is incorrect';
                }
              } else {
                this.errorMessage.set(errMsg);
              }
            }, 150);
          });
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
    if (s === 'refund') {
      return this.orders().filter(o => {
        const os = (o.order_status || '').toLowerCase();
        return os === 'refund' || os === 'pending_refund' || os === 'refund_rejected';
      }).length;
    }
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
    if (st === 'pending_refund') return 'status--pending-refund';
    if (st === 'refund_rejected') return 'status--refund-rejected';
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

  trackCarrierOrder(ord: any): void {
    if (!ord) return;
    const trackingCode = ord.shipping?.tracking_number || (ord.order_id ? ord.order_id.replace(/^OFS-/i, 'GHN-') : 'GHN-2026-00044');
    this.activeTrackingCode.set(trackingCode);
    this.showTrackingModal.set(true);
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
    } else if (status === 'refund' || status === 'pending_refund' || status === 'refund_rejected') {
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
    } else {
      this.router.navigate(['/checkout/confirmed'], { state: { order: ord, showModal: false } });
    }
  }

  completePayment(ord: any): void {
    if (!ord) return;
    if (typeof window !== 'undefined') {
      localStorage.setItem('last_order_info', JSON.stringify({
        orderId: ord.order_id,
        sessionId: ord.session_id || ''
      }));
    }
    this.selectedOrderForPayment.set(ord);
    this.showCompletePaymentModal.set(true);
  }

  updateOrderInList(updatedOrder: any): void {
    if (!updatedOrder) return;
    this.orders.update(list => list.map(o => o.order_id === updatedOrder.order_id ? updatedOrder : o));
  }

  closeCompletePaymentModal(): void {
    this.showCompletePaymentModal.set(false);
  }

  async retryPayment(): Promise<void> {
    this.showCompletePaymentModal.set(false);
    const ord = this.selectedOrderForPayment();
    if (!ord) return;

    const method = ord.payment?.method;
    
    // Clear old payment session/actions to ensure a fresh attempt
    localStorage.removeItem(`payment_qr_${ord.order_id}`);
    localStorage.removeItem(`payment_scan_action_${ord.order_id}`);

    try {
      const res = await this.checkoutService.retryPayment(ord.order_id, this.getSessionId(ord));
      const updatedOrder = res.data || ord;
      this.updateOrderInList(updatedOrder);
      this.selectedOrderForPayment.set(updatedOrder);

      if (method === 'cod' || method === 'card' || method === 'bank_transfer') {
        this.showPaymentModal.set(true);
      } else if (method === 'qr') {
        this.router.navigate(['/checkout/payment-qr'], { state: { order: updatedOrder } });
      } else {
        this.router.navigate(['/checkout/payment-qr'], { state: { order: updatedOrder } });
      }
    } catch (err) {
      console.error('Failed to reset payment status on backend for retry:', err);
      alert('Failed to initiate a new payment session. Please try again.');
    }
  }

  changePaymentMethod(): void {
    this.showCompletePaymentModal.set(false);
    this.showPaymentModal.set(false);
    this.showChangePaymentModal.set(true);
  }

  closeChangePaymentModal(): void {
    this.showChangePaymentModal.set(false);
  }

  onPaymentMethodChanged(event: { order: any; method: any }): void {
    this.showChangePaymentModal.set(false);
    this.updateOrderInList(event.order);
    this.selectedOrderForPayment.set(event.order);

    if (event.method === 'qr') {
      this.router.navigate(['/checkout/payment-qr'], { state: { order: event.order } });
    } else {
      this.showPaymentModal.set(true);
    }
  }

  onPaymentConfirmed(updatedOrder: any): void {
    this.showPaymentModal.set(false);
    this.updateOrderInList(updatedOrder);
    this.selectedOrderForPayment.set(updatedOrder);
    this.router.navigate(['/checkout/confirmed'], { replaceUrl: true, state: { order: updatedOrder } });
  }

  onPaymentCanceled(): void {
    this.showPaymentModal.set(false);
  }

  getSessionId(ord: any): string | null {
    if (ord?.session_id) return ord.session_id;
    try {
      const stored = localStorage.getItem('last_order_info');
      if (stored) {
        const info = JSON.parse(stored);
        if (info && info.orderId === ord?.order_id) {
          return info.sessionId || null;
        }
      }
    } catch (e) {}
    return null;
  }

  cancelOrder(ord: any): void {
    console.log('AccountComponent.cancelOrder called for order:', ord);
    if (!ord) return;

    this.confirmModalTitle = 'Cancel Order';
    this.confirmModalMessage = `Are you sure you want to cancel order #${ord.order_id}?`;
    this.confirmModalWarning = 'This action cannot be undone.';
    this.confirmModalConfirmText = 'Cancel Order';
    this.confirmModalCancelText = 'Keep Order';
    this.confirmModalType = 'danger';
    this.confirmModalAction = async () => {
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
    };
    this.isConfirmModalOpen = true;
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

  confirmReceipt(ord: any): void {
    console.log('AccountComponent.confirmReceipt called for order:', ord);
    if (!ord) return;

    this.confirmModalTitle = 'Confirm Receipt';
    this.confirmModalMessage = 'Have you received your package? This will mark the order as delivered.';
    this.confirmModalWarning = '';
    this.confirmModalConfirmText = 'Yes, Received';
    this.confirmModalCancelText = 'Not Yet';
    this.confirmModalType = 'success';
    this.confirmModalAction = async () => {
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
    };
    this.isConfirmModalOpen = true;
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

  onDeletePaymentCard(cardId: string): void {
    this.selectedCardForDelete.set(cardId);
    this.showDeleteCardModal.set(true);
  }

  closeDeleteCardModal(): void {
    this.showDeleteCardModal.set(false);
    this.selectedCardForDelete.set(null);
  }

  async confirmDeleteCard(): Promise<void> {
    const cardId = this.selectedCardForDelete();
    if (!cardId) return;

    this.isLoading.set(true);
    try {
      await this.checkoutService.deleteUserPaymentMethod(cardId);
      await this.fetchProfile();
      this.closeDeleteCardModal();
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

  showMore(category: 'products' | 'recipes' | 'posts' | 'blogs'): void {
    this.visibleLimits.update(limits => ({
      ...limits,
      [category]: limits[category] + 10
    }));
  }

  getRelativeTime(dateInput: any): string {
    if (!dateInput) return 'recently';
    const date = new Date(dateInput);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  getRecipeTags(recipe: any): string[] {
    if (!recipe.metadata?.tags || !Array.isArray(recipe.metadata.tags)) {
      return [];
    }
    return recipe.metadata.tags.filter((tag: string) =>
      ['HOT', 'COLD', 'DESSERT', 'COCKTAIL', 'ICED', 'FRAPPE', 'LATTE', 'AMERICANO', 'ESPRESSO'].includes(tag.toUpperCase())
    );
  }

  goToPost(event: MouseEvent, id: string) {
    event.preventDefault();

    console.log('Navigate to:', id);

    this.router.navigate(['/community/post', id]).then(result => {
      console.log('Navigate result:', result);
    }).catch(err => {
      console.error(err);
    });
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (typeof window !== 'undefined' && this.activeTab() === 'saved') {
      const scrollY = window.scrollY;
      if (scrollY > 0) {
        sessionStorage.setItem('lastScrollY', scrollY.toString());
      }
    }
  }

}