import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideChevronDown,
  LucideTrash2,
  LucideMinus,
  LucidePlus,
  LucideTruck,
  LucideRocket,
  LucideTag,
  LucideBanknote,
  LucideQrCode,
  LucideLandmark,
  LucideCreditCard,
  LucidePackage,
  LucideAlertCircle,
  LucidePencil
} from '@lucide/angular';

import {
  CheckoutItem,
  CheckoutService,
  PaymentMethod,
  ShippingMethod,
  VoucherFetchError
} from '../../services/checkout.service';
import { Product, ProductVariant } from '../../../../shared/models/product.model';
import { Voucher } from '../../../../shared/models/voucher.model';
import { AuthService } from '../../../../core/auth.service';
import { UserAddress, UserPaymentMethod, UserProfile } from '../../../../shared/models/user.model';
import { AddressModalComponent } from '../../../../shared/components/address-modal/address-modal.component';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideArrowLeft,
    LucideCheck,
    LucideChevronDown,
    LucideTrash2,
    LucideMinus,
    LucidePlus,
    LucideTruck,
    LucideRocket,
    LucideTag,
    LucideBanknote,
    LucideQrCode,
    LucideLandmark,
    LucideCreditCard,
    LucidePackage,
    LucideAlertCircle,
    LucidePencil,
    AddressModalComponent
  ],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss'
})
export class CheckoutComponent implements OnInit {
  private checkoutService = inject(CheckoutService);
  authService = inject(AuthService);

  items = signal<CheckoutItem[]>([]);
  complements = signal<Product[]>([]);
  allVouchers = signal<Voucher[]>([]);
  loading = signal(true);

  // Authenticated Profile State
  userProfile = signal<UserProfile | null>(null);
  savedAddresses = signal<UserAddress[]>([]);
  savedCards = signal<UserPaymentMethod[]>([]);
  selectedAddressId = signal<string | null>(null);
  selectedCardId = signal<string | null>(null);

  // Modals visibility and editing states
  showAddressModal = signal(false);
  showCardModal = signal(false);
  editingAddress = signal<UserAddress | null>(null);

  isOnlyAddress = computed(() => {
    const count = this.savedAddresses().length;
    if (count === 0) return true;
    if (count === 1 && this.editingAddress() !== null) return true;
    return false;
  });

  // Address and Card inline forms
  addressForm = {
    recipient_name: '',
    phone: '',
    city: '',
    detail_address: '',
    label: 'home' as 'home' | 'office' | 'other',
    is_default: false
  };

  cardForm = {
    card_type: 'credit' as 'credit' | 'debit' | 'NAPAS',
    card_number: '',
    cardholder_name: '',
    expire_date: '',
    cvc: '',
    issued_bank: '',
    is_default: false
  };

  delivery = {
    name: '',
    mobile: '',
    email: '',
    city: '',
    address: '',
    note: ''
  };

  nameTouched = false;
  mobileTouched = false;
  emailTouched = false;
  cityTouched = false;
  addressTouched = false;

  nameError = signal<string | null>(null);
  mobileError = signal<string | null>(null);
  emailError = signal<string | null>(null);
  cityError = signal<string | null>(null);
  addressError = signal<string | null>(null);

  fieldStates = signal<Record<string, 'idle' | 'typing' | 'valid' | 'invalid'>>({
    name: 'idle',
    mobile: 'idle',
    email: 'idle',
    city: 'idle',
    address: 'idle'
  });

  private debounceTimers: Record<string, any> = {};
  showCitySuggestions = false;

  readonly VIETNAM_CITIES = [
    'An Giang', 'Ba Ria - Vung Tau', 'Bac Giang', 'Bac Kan', 'Bac Lieu', 'Bac Ninh', 'Ben Tre', 'Binh Dinh', 'Binh Duong', 'Binh Phuoc', 'Binh Thuan', 'Ca Mau', 'Can Tho', 'Cao Bang', 'Da Nang', 'Dak Lak', 'Dak Nong', 'Dien Bien', 'Dong Nai', 'Dong Thap', 'Gia Lai', 'Ha Giang', 'Ha Nam', 'Ha Noi', 'Ha Tinh', 'Hai Duong', 'Hai Phong', 'Hau Giang', 'Hoa Binh', 'Ho Chi Minh', 'Hung Yen', 'Khanh Hoa', 'Kien Giang', 'Kon Tum', 'Lai Chau', 'Lam Dong', 'Lang Son', 'Lao Cai', 'Long An', 'Nam Dinh', 'Nghe An', 'Ninh Binh', 'Ninh Thuan', 'Phu Tho', 'Phu Yen', 'Quang Binh', 'Quang Nam', 'Quang Ngai', 'Quang Ninh', 'Quang Tri', 'Soc Trang', 'Son La', 'Tay Ninh', 'Thai Binh', 'Thai Nguyen', 'Thanh Hoa', 'Thua Thien Hue', 'Tien Giang', 'Tra Vinh', 'Tuyen Quang', 'Vinh Long', 'Vinh Phuc', 'Yen Bai'
  ];

  private readonly INTERNATIONAL_CITIES = [
    'San Francisco', 'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
    'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
    'Seattle', 'Boston', 'Miami', 'Denver', 'London', 'Manchester', 'Birmingham', 'Leeds',
    'Glasgow', 'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Tokyo', 'Osaka', 'Kyoto',
    'Yokohama', 'Nagoya', 'Singapore', 'Kuala Lumpur', 'Bangkok', 'Jakarta', 'Manila',
    'Seoul', 'Busan', 'Incheon', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide',
    'Toronto', 'Montreal', 'Vancouver', 'Ottawa', 'Berlin', 'Munich', 'Frankfurt', 'Hamburg',
    'Rome', 'Milan', 'Naples', 'Turin', 'Madrid', 'Barcelona', 'Valencia', 'Seville',
    'Amsterdam', 'Rotterdam', 'Utrecht', 'Bangalore', 'Mumbai', 'Delhi', 'Kolkata',
    'Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu'
  ];

  private readonly REAL_CITIES = new Set<string>();

  private populateRealCities() {
    for (const c of this.VIETNAM_CITIES) {
      this.REAL_CITIES.add(this.normalizeString(c));
    }
    for (const c of this.INTERNATIONAL_CITIES) {
      this.REAL_CITIES.add(this.normalizeString(c));
    }
    const aliases = ['hanoi', 'saigon', 'ho chi minh city', 'hcmc', 'hcm'];
    for (const a of aliases) this.REAL_CITIES.add(a);
  }

  normalizeString(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
  }

  validateName(): string | null {
    return this.delivery.name.trim() ? null : 'Name is required.';
  }

  validateMobile(): string | null {
    const val = this.delivery.mobile;
    if (!val) {
      return 'Mobile number is required.';
    }
    const normalized = val.replace(/\s+/g, '');
    if (!/^\d+$/.test(normalized)) {
      return 'Mobile number must contain digits and spaces only.';
    }
    if (normalized.length < 10 || normalized.length > 11) {
      return 'Mobile number must be 10 to 11 digits.';
    }
    return null;
  }

  validateEmail(): string | null {
    const val = this.delivery.email.trim();
    if (!val) return null;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(val)) {
      return 'Invalid email format.';
    }
    return null;
  }

  validateCity(): string | null {
    const val = this.delivery.city.trim();
    if (!val) {
      return 'City is required.';
    }
    const normalized = this.normalizeString(val);
    if (!this.REAL_CITIES.has(normalized)) {
      return 'City not exists.';
    }
    return null;
  }

  get citySuggestions(): string[] {
    const val = this.normalizeString(this.delivery.city);
    if (!val) return [];
    return this.VIETNAM_CITIES.filter(c => {
      const normCity = this.normalizeString(c);
      return normCity.startsWith(val) || normCity.split(/\s+/).some(w => w.startsWith(val));
    }).filter(c => this.normalizeString(c) !== val);
  }

  onCityInput() {
    this.showCitySuggestions = true;
    this.onFieldInput('city');
  }

  onCityBlur() {
    setTimeout(() => {
      this.showCitySuggestions = false;
      this.onFieldBlur('city');
    }, 200);
  }

  selectCity(city: string) {
    this.delivery.city = city;
    this.cityTouched = true;
    this.showCitySuggestions = false;
    this.onFieldBlur('city');
  }

  validateAddress(): string | null {
    const val = this.delivery.address.trim();
    if (!val) {
      return 'Address is required.';
    }
    if (!/^\d+/.test(val)) {
      return 'Address must start with a house number.';
    }
    if (!val.includes(',')) {
      return 'Address must include a comma to separate the street and ward.';
    }
    const parts = val.split(',').map(p => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return 'Address must contain street name and ward name.';
    }
    const streetPart = parts[0].replace(/^\d+[-/a-zA-Z\d]*\s*/, '').trim();
    if (streetPart.length < 2) {
      return 'Street name must be at least 2 characters long.';
    }
    if (parts[1].length < 2) {
      return 'Ward name must be at least 2 characters long.';
    }
    return null;
  }

  onFieldInput(field: 'name' | 'mobile' | 'email' | 'city' | 'address') {
    this.setTouched(field);

    const currentVal = this.getFieldValue(field);
    const error = this.runValidation(field);

    if (error) {
      this.setFieldError(field, error);
      this.setFieldState(field, 'invalid');
    } else {
      this.setFieldError(field, null);
      this.setFieldState(field, currentVal ? 'valid' : 'idle');
    }
  }

  onFieldBlur(field: 'name' | 'mobile' | 'email' | 'city' | 'address') {
    this.onFieldInput(field);
  }

  private getFieldValue(field: string): string {
    return (this.delivery[field as keyof typeof this.delivery] || '').trim();
  }

  private runValidation(field: string): string | null {
    switch (field) {
      case 'name':
        return this.validateName();
      case 'mobile':
        return this.validateMobile();
      case 'email':
        return this.validateEmail();
      case 'city':
        return this.validateCity();
      case 'address':
        return this.validateAddress();
      default:
        return null;
    }
  }

  private setFieldError(field: string, error: string | null) {
    const errorSignal = (this as any)[`${field}Error`] as ReturnType<typeof signal<string | null>>;
    if (errorSignal && typeof errorSignal.set === 'function') {
      errorSignal.set(error);
    }
  }

  private setFieldState(field: string, state: 'idle' | 'typing' | 'valid' | 'invalid') {
    this.fieldStates.update(states => ({
      ...states,
      [field]: state
    }));
  }

  private setTouched(field: string) {
    const touchedProp = `${field}Touched` as any;
    if (touchedProp in this) {
      (this as any)[touchedProp] = true;
    }
  }

  get isFormInvalid(): boolean {
    if (this.paymentMethod() === 'card' && this.userProfile() && this.savedCards().length > 0 && !this.selectedCardId()) {
      return true;
    }

    if (this.nameError() || this.mobileError() || this.emailError() || this.cityError() || this.addressError()) {
      return true;
    }

    const d = this.delivery;
    if (!d.name.trim() || !d.mobile.trim() || !d.city.trim() || !d.address.trim()) {
      return true;
    }

    const mobileNormalized = d.mobile.replace(/\s+/g, '');
    if (!/^\d{10,11}$/.test(mobileNormalized)) return true;

    const emailVal = d.email.trim();
    if (emailVal) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(emailVal)) return true;
    }

    const normalizedCity = this.normalizeString(d.city);
    if (!this.REAL_CITIES.has(normalizedCity)) return true;

    if (this.validateAddress() !== null) return true;

    return false;
  }

  shippingMethod = signal<ShippingMethod>('fast');
  readonly shippingCost = computed(() =>
    this.shippingMethod() === 'express' ? 15 : 0
  );

  paymentMethod = signal<PaymentMethod>('cod');

  discountCode = '';
  appliedVoucher = signal<Voucher | null>(null);
  voucherError = signal<string | null>(null);
  applyingVoucher = signal(false);

  readonly subtotal = computed(() =>
    this.items().reduce((sum, it) => {
      const v = this.checkoutService.getVariant(it.product, it.variantSku);
      return sum + v.price * it.quantity;
    }, 0)
  );

  readonly discountAmount = computed(() => {
    const v = this.appliedVoucher();
    if (!v) return 0;
    return this.computeVoucherAmount(v);
  });

  readonly total = computed(
    () => this.subtotal() + this.shippingCost() - this.discountAmount()
  );

  readonly suggestedVoucher = computed(() => {
    const vouchers = this.allVouchers();
    if (!vouchers.length) return null;

    const now = new Date().toISOString();
    const activeVouchers = vouchers.filter(v => {
      if (!v.is_active) return false;
      if (v.valid_from && now < v.valid_from) return false;
      if (v.valid_to && now > v.valid_to) return false;
      if (v.usage_limit != null && v.used_count >= v.usage_limit) return false;
      return true;
    });

    let bestVoucher: Voucher | null = null;
    let maxDiscount = 0;

    for (const v of activeVouchers) {
      const issue = this.validateVoucher(v);
      if (issue) continue;

      const discount = this.computeVoucherAmount(v);
      if (discount > maxDiscount) {
        maxDiscount = discount;
        bestVoucher = v;
      }
    }

    return bestVoucher ? { voucher: bestVoucher, discount: maxDiscount } : null;
  });

  readonly motivationMessage = computed(() => {
    if (this.appliedVoucher()) return null;

    const suggestion = this.suggestedVoucher();
    if (suggestion) {
      return {
        type: 'eligible',
        code: suggestion.voucher.code,
        discount: suggestion.discount.toFixed(2),
        needed: '0.00'
      };
    }

    const vouchers = this.allVouchers();
    if (!vouchers.length) return null;

    const subtotal = this.subtotal();
    const currentDiscount = this.discountAmount();
    const now = new Date().toISOString();
    const activeVouchers = vouchers.filter(v => {
      if (!v.is_active) return false;
      if (v.valid_from && now < v.valid_from) return false;
      if (v.valid_to && now > v.valid_to) return false;
      if (v.usage_limit != null && v.used_count >= v.usage_limit) return false;
      return true;
    });

    const candidates = activeVouchers
      .filter(v => (v.min_order_amount ?? 0) > subtotal)
      .map(v => {
        const needed = v.min_order_amount! - subtotal;
        const discount = this.computeVoucherAmountAtSubtotal(v, v.min_order_amount!);
        return { voucher: v, needed, discount };
      })
      .filter(c => c.discount > currentDiscount);

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (a.needed !== b.needed) {
        return a.needed - b.needed;
      }
      return b.discount - a.discount;
    });

    const best = candidates[0];

    return {
      type: 'motivate',
      needed: best.needed.toFixed(2),
      discount: best.discount.toFixed(2),
      code: best.voucher.code
    };
  });

  constructor() {
    this.populateRealCities();

    effect(() => {
      const v = this.appliedVoucher();
      if (!v) return;
      const issue = this.validateVoucher(v);
      if (issue) {
        this.appliedVoucher.set(null);
        this.voucherError.set(issue);
      } else {
        this.voucherError.set(null);
      }
    }, { allowSignalWrites: true });
  }

  async ngOnInit() {
    try {
      const [cart, products, vouchers] = await Promise.all([
        this.checkoutService.getMockCartItems(),
        this.checkoutService.getAllProducts(),
        this.checkoutService.getVouchers()
      ]);
      this.items.set(cart);
      this.complements.set(
        this.checkoutService.buildComplements(cart, products)
      );
      this.allVouchers.set(vouchers);

      // Load user profile if logged in
      await this.loadUserProfile();
    } catch (err) {
      console.error('Failed to load checkout data:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async loadUserProfile() {
    if (this.authService.isAuthenticated()) {
      try {
        const profile = await this.checkoutService.getUserProfile();
        this.userProfile.set(profile);

        const addresses = profile.addresses || [];
        addresses.sort((a: UserAddress, b: UserAddress) => {
          if (a.is_default && !b.is_default) return -1;
          if (!a.is_default && b.is_default) return 1;
          return 0;
        });
        this.savedAddresses.set(addresses);

        const cards = profile.payment_methods || [];
        cards.sort((a: UserPaymentMethod, b: UserPaymentMethod) => {
          if (a.is_default && !b.is_default) return -1;
          if (!a.is_default && b.is_default) return 1;
          return 0;
        });
        this.savedCards.set(cards);

        // Auto select default address
        if (addresses.length > 0) {
          const defAddr = addresses.find((a: UserAddress) => a.is_default) || addresses[0];
          if (defAddr && defAddr._id) {
            this.selectAddress(defAddr);
          }
        }

        // Auto select default card
        if (cards.length > 0) {
          const defCard = cards.find((c: UserPaymentMethod) => c.is_default) || cards[0];
          if (defCard && defCard._id) {
            this.selectedCardId.set(defCard._id);
          }
        }
      } catch (err) {
        console.error('Failed to load user profile:', err);
      }
    }
  }

  selectAddress(addr: UserAddress) {
    if (addr._id) {
      this.selectedAddressId.set(addr._id);
      this.delivery.name = addr.recipient_name;
      this.delivery.mobile = addr.phone;
      this.delivery.city = addr.city;
      this.delivery.address = addr.detail_address;
      this.delivery.email = this.userProfile()?.email || '';

      // Reset touch states and validations
      this.nameError.set(null);
      this.mobileError.set(null);
      this.cityError.set(null);
      this.addressError.set(null);
      this.fieldStates.update(states => ({
        ...states,
        name: 'valid',
        mobile: 'valid',
        city: 'valid',
        address: 'valid'
      }));
    }
  }

  openAddAddressModal() {
    this.editingAddress.set(null);
    this.showAddressModal.set(true);
  }

  openEditAddressModal(addr: UserAddress, event: Event) {
    event.stopPropagation();
    this.editingAddress.set(addr);
    this.showAddressModal.set(true);
  }

  async syncProfileAndSelections() {
    try {
      const res = await this.checkoutService.getUserProfile();
      this.userProfile.set(res);

      // Get old default address before overwriting the signal
      const oldDefaultAddr = this.savedAddresses().find(a => a.is_default);

      const addresses = res.addresses || [];
      addresses.sort((a: UserAddress, b: UserAddress) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return 0;
      });
      this.savedAddresses.set(addresses);

      const cards = res.payment_methods || [];
      cards.sort((a: UserPaymentMethod, b: UserPaymentMethod) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return 0;
      });
      this.savedCards.set(cards);

      // Detect if default address changed
      const defaultAddr = addresses.find((a: UserAddress) => a.is_default);
      const defaultChanged = (!oldDefaultAddr && defaultAddr) || 
                             (oldDefaultAddr && defaultAddr && oldDefaultAddr._id !== defaultAddr._id);

      const prevAddrId = this.selectedAddressId();

      if (defaultAddr && (defaultChanged || !prevAddrId)) {
        this.selectAddress(defaultAddr);
      } else {
        const matchedAddr = addresses.find((a: UserAddress) => a._id === prevAddrId);
        if (matchedAddr) {
          this.selectAddress(matchedAddr);
        } else if (defaultAddr) {
          this.selectAddress(defaultAddr);
        } else if (addresses.length > 0) {
          this.selectAddress(addresses[0]);
        } else {
          this.selectedAddressId.set(null);
          this.delivery.name = '';
          this.delivery.mobile = '';
          this.delivery.city = '';
          this.delivery.address = '';
          this.fieldStates.update(states => ({
            ...states,
            name: 'idle',
            mobile: 'idle',
            city: 'idle',
            address: 'idle'
          }));
        }
      }

      // Resolve card selection
      const prevCardId = this.selectedCardId();
      const matchedCard = cards.find((c: UserPaymentMethod) => c._id === prevCardId && !this.isCardExpired(c.expire_date));
      if (matchedCard) {
        this.selectedCardId.set(matchedCard._id || null);
      } else {
        const defaultCard = cards.find((c: UserPaymentMethod) => c.is_default && !this.isCardExpired(c.expire_date));
        if (defaultCard) {
          this.selectedCardId.set(defaultCard._id || null);
        } else {
          const activeCard = cards.find((c: UserPaymentMethod) => !this.isCardExpired(c.expire_date));
          if (activeCard) {
            this.selectedCardId.set(activeCard._id || null);
          } else {
            this.selectedCardId.set(null);
          }
        }
      }
    } catch (err) {
      console.error('Failed to sync profile and selections:', err);
    }
  }

  async onAddressModalSave(formPayload: Omit<UserAddress, '_id'>) {
    try {
      this.loading.set(true);
      const editing = this.editingAddress();
      if (editing && editing._id) {
        await this.checkoutService.updateUserAddress(editing._id, formPayload);
      } else {
        const res = await this.checkoutService.addUserAddress(formPayload);
        if (this.savedAddresses().length === 0) {
          this.selectedAddressId.set(res.address._id || null);
        }
      }
      await this.syncProfileAndSelections();
      this.showAddressModal.set(false);
    } catch (err) {
      console.error('Failed to save address:', err);
      alert('Failed to save address. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  onAddressModalCancel() {
    this.showAddressModal.set(false);
  }

  async deleteAddress(addr: UserAddress, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this address?')) return;

    if (addr._id) {
      try {
        this.loading.set(true);
        await this.checkoutService.deleteUserAddress(addr._id);
        if (this.selectedAddressId() === addr._id) {
          this.selectedAddressId.set(null);
        }
        await this.syncProfileAndSelections();
      } catch (err) {
        console.error('Failed to delete address:', err);
        alert('Failed to delete address.');
      } finally {
        this.loading.set(false);
      }
    }
  }

  openAddCardModal() {
    this.cardForm = {
      card_type: 'credit',
      card_number: '',
      cardholder_name: '',
      expire_date: '',
      cvc: '',
      issued_bank: '',
      is_default: this.savedCards().length === 0
    };
    this.showCardModal.set(true);
  }

  async saveCard() {
    if (!this.cardForm.card_number.trim() || 
        !this.cardForm.cardholder_name.trim() || 
        !this.cardForm.expire_date.trim()) {
      alert('Please fill out card details.');
      return;
    }

    try {
      this.loading.set(true);
      const res = await this.checkoutService.addUserPaymentMethod(this.cardForm);
      if (res.payment_method._id) {
        this.selectedCardId.set(res.payment_method._id);
      }
      await this.syncProfileAndSelections();
      this.showCardModal.set(false);
    } catch (err) {
      console.error('Failed to save card:', err);
      alert('Failed to save card.');
    } finally {
      this.loading.set(false);
    }
  }

  async deleteCard(card: UserPaymentMethod, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this payment card?')) return;

    if (card._id) {
      try {
        this.loading.set(true);
        await this.checkoutService.deleteUserPaymentMethod(card._id);
        if (this.selectedCardId() === card._id) {
          this.selectedCardId.set(null);
        }
        await this.syncProfileAndSelections();
      } catch (err) {
        console.error('Failed to delete card:', err);
        alert('Failed to delete card.');
      } finally {
        this.loading.set(false);
      }
    }
  }

  getCardLabel(c: UserPaymentMethod): string {
    let typeName = 'Card';
    if (c.card_type === 'NAPAS') typeName = 'Napas';
    else if (c.card_number.startsWith('4')) typeName = 'Visa';
    else if (c.card_number.startsWith('5')) typeName = 'Mastercard';
    const last4 = c.card_number.slice(-4);
    return `${typeName} **${last4}`;
  }

  isCardExpired(expireDate: string): boolean {
    if (!expireDate) return false;
    const parts = expireDate.split('/');
    if (parts.length !== 2) return false;
    const expMonth = parseInt(parts[0], 10);
    const expYear = parseInt('20' + parts[1], 10);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    if (currentYear > expYear) return true;
    if (currentYear === expYear && currentMonth > expMonth) return true;
    return false;
  }

  getVariant(item: CheckoutItem): ProductVariant {
    return this.checkoutService.getVariant(item.product, item.variantSku);
  }

  getItemImage(item: CheckoutItem): string {
    const v = this.getVariant(item);
    return v.images?.[0]?.url ?? item.product.images?.[0]?.url ?? '';
  }

  getItemPrice(item: CheckoutItem): number {
    return this.getVariant(item).price;
  }

  trackByItem = (_: number, it: CheckoutItem) =>
    `${it.product._id}::${it.variantSku}`;

  trackByProduct = (_: number, p: Product) => p._id;

  changeVariant(item: CheckoutItem, sku: string) {
    this.items.update(list =>
      list.map(it => (it === item ? { ...it, variantSku: sku } : it))
    );
  }

  inc(item: CheckoutItem) {
    this.items.update(list =>
      list.map(it =>
        it === item ? { ...it, quantity: it.quantity + 1 } : it
      )
    );
  }

  dec(item: CheckoutItem) {
    this.items.update(list =>
      list.map(it =>
        it === item
          ? { ...it, quantity: Math.max(1, it.quantity - 1) }
          : it
      )
    );
  }

  remove(item: CheckoutItem) {
    this.items.update(list => list.filter(it => it !== item));
  }

  selectShipping(id: ShippingMethod) {
    this.shippingMethod.set(id);
  }

  selectPayment(id: PaymentMethod) {
    this.paymentMethod.set(id);
  }

  async applyDiscount() {
    const code = this.discountCode.trim().toUpperCase();
    this.voucherError.set(null);

    if (!code) {
      this.voucherError.set('Enter a code to apply.');
      return;
    }
    if (this.appliedVoucher()?.code === code) return;

    this.applyingVoucher.set(true);
    try {
      const voucher = await this.checkoutService.fetchVoucher(code);
      const issue = this.validateVoucher(voucher);
      if (issue) {
        this.voucherError.set(issue);
        return;
      }
      this.appliedVoucher.set(voucher);
      this.discountCode = '';
    } catch (err) {
      if (err instanceof VoucherFetchError) {
        this.voucherError.set(
          err.status === 404
            ? `Code "${code}" doesn't exist.`
            : err.message
        );
      } else {
        this.voucherError.set('Could not validate code. Try again.');
      }
    } finally {
      this.applyingVoucher.set(false);
    }
  }

  removeVoucher() {
    this.appliedVoucher.set(null);
    this.voucherError.set(null);
  }

  applySuggestedVoucher(voucher: Voucher) {
    this.appliedVoucher.set(voucher);
    this.discountCode = '';
    this.voucherError.set(null);
  }

  private validateVoucher(v: Voucher): string | null {
    const sub = this.subtotal();
    const min = v.min_order_amount ?? 0;
    if (min > 0 && sub < min) {
      const diff = (min - sub).toFixed(2);
      return `Buy $${diff} more to use this voucher.`;
    }
    if (v.voucher_type === 'shipping' && this.shippingMethod() !== 'express') {
      return 'This code only applies with Express Delivery.';
    }
    return null;
  }

  private computeVoucherAmount(v: Voucher): number {
    return this.computeVoucherAmountAtSubtotal(v, this.subtotal());
  }

  private computeVoucherAmountAtSubtotal(v: Voucher, customSubtotal: number): number {
    let amount: number;

    if (v.voucher_type === 'discount') {
      amount =
        v.discount_type === 'percentage'
          ? customSubtotal * (v.discount_value / 100)
          : v.discount_value;
    } else {
      const ship = this.shippingCost();
      amount =
        v.discount_type === 'percentage'
          ? ship * (v.discount_value / 100)
          : Math.min(v.discount_value, ship);
    }

    if (v.max_discount_value != null && amount > v.max_discount_value) {
      amount = v.max_discount_value;
    }
    return Math.round(amount * 100) / 100;
  }

  async addComplement(product: Product) {
    if (!product.variants?.length) return;
    const variant =
      product.variants.find(v => v.is_default) ?? product.variants[0];

    this.items.update(list => {
      const existing = list.find(
        it => it.product._id === product._id && it.variantSku === variant.sku
      );
      if (existing) {
        return list.map(it =>
          it === existing ? { ...it, quantity: it.quantity + 1 } : it
        );
      }
      return [...list, { product, variantSku: variant.sku, quantity: 1 }];
    });

    const remaining = this.complements().filter(p => p._id !== product._id);
    const allProducts = await this.checkoutService.getAllProducts();
    const excluded = new Set<string>([
      ...this.items().map(i => i.product._id),
      ...remaining.map(p => p._id)
    ]);
    const replacement = this.checkoutService.pickComplementReplacement(
      this.items(),
      allProducts,
      excluded
    );
    this.complements.set(replacement ? [...remaining, replacement] : remaining);
  }

  productThumb(p: Product): string {
    return (
      p.images?.[0]?.url ??
      p.variants?.[0]?.images?.[0]?.url ??
      ''
    );
  }

  productStartingPrice(p: Product): number {
    if (!p.variants?.length) return 0;
    const def = p.variants.find(v => v.is_default) ?? p.variants[0];
    return def.price;
  }

  async confirmOrder() {
    this.onFieldBlur('name');
    this.onFieldBlur('mobile');
    this.onFieldBlur('email');
    this.onFieldBlur('city');
    this.onFieldBlur('address');

    if (this.isFormInvalid) {
      alert('Please fill out the delivery form correctly.');
      return;
    }

    if (!this.items().length) {
      alert('Your cart is empty.');
      return;
    }

    const isGuest = !this.authService.isAuthenticated();

    const backendItems = this.items().map(it => {
      const variant = this.getVariant(it);
      return {
        product_id: it.product._id,
        variant_id: variant.sku,
        product_name: it.product.name,
        variant_name: variant.label || '',
        image: {
          url: variant.images?.[0]?.url || it.product.images?.[0]?.url || '',
          public_id: variant.images?.[0]?.public_id || it.product.images?.[0]?.public_id || 'default'
        },
        unit_price: variant.price,
        quantity: it.quantity,
        subtotal: variant.price * it.quantity
      };
    });

    let paymentPayload: any = {
      method: this.paymentMethod()
    };

    if (this.paymentMethod() === 'card') {
      const selectedCard = this.savedCards().find(c => c._id === this.selectedCardId());
      if (selectedCard) {
        let brand = 'Visa';
        if (selectedCard.card_type === 'NAPAS') brand = 'Napas';
        else if (selectedCard.card_number.startsWith('5')) brand = 'Mastercard';
        
        paymentPayload.card_info = {
          brand: brand,
          last4: selectedCard.card_number.slice(-4)
        };
      }
    }

    const orderPayload = {
      items: backendItems,
      delivery_info: {
        recipient_name: this.delivery.name,
        mobile: this.delivery.mobile,
        email: this.delivery.email || 'guest@example.com',
        city: this.delivery.city,
        address: this.delivery.address,
        note: this.delivery.note || ''
      },
      shipping: {
        method: this.shippingMethod() === 'express' ? 'express' : 'standard',
        cost: this.shippingCost()
      },
      payment: paymentPayload,
      pricing: {
        subtotal: this.subtotal(),
        shipping_cost: this.shippingCost(),
        discount_amount: this.discountAmount(),
        total: this.total(),
        currency: 'USD'
      },
      coupon: this.appliedVoucher() ? {
        code: this.appliedVoucher()!.code,
        discount_type: this.appliedVoucher()!.discount_type,
        discount_value: this.appliedVoucher()!.discount_value,
        discount_amount: this.discountAmount()
      } : null,
      session_id: isGuest ? 'SS' + Math.floor(Math.random() * 100000) : null
    };

    try {
      this.loading.set(true);
      const res = await this.checkoutService.submitOrder(orderPayload);
      alert(`Order confirmed successfully! Order ID: ${res.data.order_id}`);
      this.items.set([]);
    } catch (err: any) {
      console.error('Failed to submit order:', err);
      alert(err.error?.error || 'Failed to place order. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
