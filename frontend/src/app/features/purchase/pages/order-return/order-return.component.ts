import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideBanknote,
  LucideUpload,
  LucideInfo,
  LucideChevronDown,
  LucidePackage,
  LucideCreditCard,
  LucidePlus,
  LucideLandmark,
  LucideX
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../../../core/auth.service';
import { InlineValidator, FieldConfig } from '../../../../shared/utils/inline-validator';

const VIETNAM_BANK_LIST = ['Vietcombank', 'BIDV', 'Techcombank', 'VietinBank', 'Agribank', 'MB Bank', 'VPBank', 'ACB', 'Sacombank', 'TPBank', 'VIB', 'SHB', 'MSB', 'SeABank'];

@Component({
  selector: 'app-order-return',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideArrowLeft,
    LucideCheck,
    LucideBanknote,
    LucideUpload,
    LucideInfo,
    LucideChevronDown,
    LucidePackage,
    LucideCreditCard,
    LucidePlus,
    LucideLandmark,
    LucideX
  ],
  templateUrl: './order-return.component.html',
  styleUrl: './order-return.component.scss'
})
export class OrderReturnComponent implements OnInit {
  public router = inject(Router);
  private route = inject(ActivatedRoute);
  private checkoutService = inject(CheckoutService);
  private authService = inject(AuthService);

  orderId = signal<string | null>(null);
  order = signal<any>(null);
  loading = signal<boolean>(true);

  // Form Fields
  reason = signal<string>('');
  otherReasonText = signal<string>('');
  otherReasonWordCount = signal<number>(0);
  description = signal<string>('');
  evidenceFiles = signal<Array<{ name: string; size: string; url: string; file: File }>>([]);

  // Refund destination card signals
  showRefundPaymentModal = signal<boolean>(false);
  selectedRefundPayment = signal<any>(null); // { method: 'card'|'bank_transfer', card_info: { brand: string, last4: string, cardholder_name: string } }
  savedCards = signal<any[]>([]); // cards list from profile
  isAddingNew = signal<boolean>(false);
  modalPaymentMethod = signal<'card' | 'bank_transfer'>('card');
  selectedSavedCardId = signal<string | null>(null);

  cardValidator: InlineValidator | null = null;
  bankValidator: InlineValidator | null = null;

  // New Payment Form fields
  cardForm = {
    card_type: 'credit' as 'credit' | 'debit' | 'NAPAS',
    card_number: '',
    cardholder_name: '',
    expire_date: '',
    cvc: '',
    issued_bank: ''
  };

  // Form Field validation touched states for modal form
  cardFormTouched = {
    cardholder_name: false,
    card_number: false,
    expire_date: false,
    cvc: false,
    issued_bank: false
  };

  bankList = ['Vietcombank', 'BIDV', 'Techcombank', 'VietinBank', 'Agribank', 'MB Bank', 'VPBank', 'ACB', 'Sacombank', 'TPBank', 'VIB', 'SHB', 'MSB', 'SeABank'];

  // Touched validation states
  reasonTouched = signal<boolean>(false);
  otherReasonTouched = signal<boolean>(false);
  evidenceTouched = signal<boolean>(false);
  itemsTouched = signal<boolean>(false);
  
  // Selection states for items
  selectedItems = signal<Record<string, boolean>>({});
  refundQuantities = signal<Record<string, number>>({});

  reasonsList = [
    'Damaged item',
    'Wrong item',
    'Size/color mismatch',
    'Other'
  ];

  ngOnInit() {
    this.route.paramMap.subscribe(async params => {
      const id = params.get('id');
      this.orderId.set(id);
      if (id) {
        await this.loadOrderDetails(id);
      } else {
        this.router.navigate(['/']);
      }
    });
  }

  async loadOrderDetails(id: string) {
    try {
      this.loading.set(true);

      let ord = history.state?.['order'];
      let sessionId: string | null = null;
      const savedInfo = localStorage.getItem('last_order_info');
      if (savedInfo) {
        try {
          const parsed = JSON.parse(savedInfo);
          if (parsed && (parsed.orderId === id || parsed.order_id === id)) {
            sessionId = parsed.sessionId || null;
          }
        } catch (e) {}
      }

      if (!ord || (ord.order_id !== id && ord._id !== id)) {
        ord = await this.checkoutService.getOrderStatus(id, sessionId);
      }
      
      this.order.set(ord);

      // Access control
      if (ord.user_id) {
        const currentUser = this.authService.getUser();
        if (!currentUser || currentUser.user_id !== ord.user_id) {
          alert('Access denied. You do not have permission to request a refund for this order.');
          this.router.navigate(['/order-tracking']);
          return;
        }
      }

      // Check order status
      if (ord.order_status !== 'delivered' && ord.order_status !== 'refund_rejected') {
        alert('Refund/return can only be requested for delivered orders.');
        this.router.navigate(['/order-tracking']);
        return;
      }

      if (ord.refund_request?.status === 'pending') {
        alert('A refund request is already pending review for this order.');
        this.router.navigate(['/checkout/refund'], { state: { order: ord } });
        return;
      }

      if (ord.refund_request?.status === 'approved' || ord.order_status === 'refund') {
        this.router.navigate(['/checkout/refund'], { state: { order: ord } });
        return;
      }

      // Load user profile to get saved cards if authenticated
      if (this.authService.isAuthenticated()) {
        try {
          const profileResponse = await this.authService.getMe();
          if (profileResponse?.user?.payment_methods) {
            this.savedCards.set(profileResponse.user.payment_methods);
            // Pre-select default card if exists
            const defaultCard = profileResponse.user.payment_methods.find((c: any) => c.is_default);
            if (defaultCard) {
              this.selectedSavedCardId.set(defaultCard._id);
            } else if (profileResponse.user.payment_methods.length > 0) {
              this.selectedSavedCardId.set(profileResponse.user.payment_methods[0]._id);
            }
          }
        } catch (err) {
          console.error('Failed to load user profile for payment methods:', err);
        }
      }

      // Initialize all items as selected by default
      const initialSelection: Record<string, boolean> = {};
      const initialQuantities: Record<string, number> = {};
      if (ord.items) {
        ord.items.forEach((item: any) => {
          initialSelection[item.variant_id] = true;
          initialQuantities[item.variant_id] = item.quantity;
        });
      }
      this.selectedItems.set(initialSelection);
      this.refundQuantities.set(initialQuantities);

    } catch (err) {
      console.error('Failed to load order details for return:', err);
      alert('Failed to load order details. Redirecting to tracking.');
      this.router.navigate(['/order-tracking']);
    } finally {
      this.loading.set(false);
    }
  }

  toggleItemSelection(variantId: string) {
    this.selectedItems.update(selection => ({
      ...selection,
      [variantId]: !selection[variantId]
    }));
  }

  isItemSelected(variantId: string): boolean {
    return !!this.selectedItems()[variantId];
  }

  decrementQty(variantId: string) {
    this.refundQuantities.update(qtys => {
      const current = qtys[variantId] || 1;
      return {
        ...qtys,
        [variantId]: Math.max(1, current - 1)
      };
    });
  }

  incrementQty(variantId: string, maxQty: number) {
    this.refundQuantities.update(qtys => {
      const current = qtys[variantId] || 1;
      return {
        ...qtys,
        [variantId]: Math.min(maxQty, current + 1)
      };
    });
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 10 * 1024 * 1024) {
          alert(`File ${file.name} is too large. Max size is 10MB.`);
          continue;
        }
        
        const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        const previewUrl = URL.createObjectURL(file);

        this.evidenceFiles.update(list => [
          ...list,
          { name: file.name, size: sizeStr, url: previewUrl, file }
        ]);
      }
    }
  }

  removeFile(index: number) {
    const current = this.evidenceFiles();
    const removed = current[index];
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    this.evidenceFiles.update(list => list.filter((_, i) => i !== index));
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  private async buildEvidencePayload(): Promise<string[]> {
    const files = this.evidenceFiles();
    const payloads: string[] = [];

    for (const entry of files) {
      if (entry.file) {
        payloads.push(await this.readFileAsDataUrl(entry.file));
      } else if (entry.url && !entry.url.startsWith('blob:')) {
        payloads.push(entry.url);
      }
    }

    return payloads;
  }

  checkOtherReasonWords(text: string) {
    if (!text) {
      this.otherReasonWordCount.set(0);
      return;
    }
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    this.otherReasonWordCount.set(words.length);
  }

  isVideoFile(file: { name: string; file?: File }): boolean {
    if (file.file?.type?.startsWith('video/')) {
      return true;
    }
    return /\.(mp4|webm|mov|ogg|m4v)$/i.test(file.name);
  }

  get selectedItemsList() {
    const ord = this.order();
    if (!ord || !ord.items) return [];
    return ord.items.filter((item: any) => this.isItemSelected(item.variant_id));
  }

  get subtotal(): number {
    return this.selectedItemsList.reduce((sum: number, item: any) => {
      const qty = this.refundQuantities()[item.variant_id] || item.quantity;
      return sum + item.unit_price * qty;
    }, 0);
  }

  get discountAmount(): number {
    const ord = this.order();
    if (!ord || !ord.pricing || !ord.pricing.discount_amount || !ord.pricing.subtotal) return 0;
    
    const ratio = this.subtotal / ord.pricing.subtotal;
    return Math.round((ratio * ord.pricing.discount_amount) * 100) / 100;
  }

  get totalRefund(): number {
    return Math.max(0, this.subtotal - this.discountAmount);
  }

  get isFormInvalid(): boolean {
    if (!this.reason()) return true;
    if (this.selectedItemsList.length === 0) return true;

    if (this.reason() === 'Other') {
      if (!this.otherReasonText().trim()) return true;
      if (this.otherReasonWordCount() > 200) return true;
    }

    if (this.evidenceFiles().length === 0) return true;

    if (this.description() && this.description().trim().length < 20) return true;

    const ord = this.order();
    if (ord && (ord.payment?.method === 'cod' || ord.payment?.method === 'qr')) {
      if (!this.selectedRefundPayment()) return true;
    }

    return false;
  }

  async submitRefundRequest() {
    this.reasonTouched.set(true);
    this.otherReasonTouched.set(true);
    this.evidenceTouched.set(true);
    this.itemsTouched.set(true);

    if (this.isFormInvalid) return;

    try {
      this.loading.set(true);

      const id = this.orderId();
      if (!id) return;

      let sessionId: string | null = null;
      const savedInfo = localStorage.getItem('last_order_info');
      if (savedInfo) {
        try {
          const parsed = JSON.parse(savedInfo);
          if (parsed && (parsed.orderId === id || parsed.order_id === id)) {
            sessionId = parsed.sessionId || null;
          }
        } catch (e) {}
      }

      const evidence = await this.buildEvidencePayload();
      if (!evidence.length) {
        alert('Please upload at least one image or video as supporting evidence.');
        return;
      }

      const payload = {
        reason: this.reason(),
        other_reason: this.reason() === 'Other' ? this.otherReasonText().trim() : undefined,
        description: this.description()?.trim() || undefined,
        evidence,
        refund_item: this.selectedItemsList.map((item: any) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: this.refundQuantities()[item.variant_id] || item.quantity
        })),
        refund_payment: this.selectedRefundPayment() || undefined
      };

      const res = await this.checkoutService.requestRefund(id, payload, sessionId);
      alert('Refund/return request submitted successfully!');
      
      const ord = res.data;
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
    } catch (err: any) {
      console.error('Failed to submit refund request:', err);
      alert(err.error?.error || 'Failed to submit request. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  getPaymentLabel(order: any): string {
    if (!order || !order.payment) return '';
    const pm = order.payment.method;
    if (pm === 'cod' || pm === 'qr') {
      const selected = this.selectedRefundPayment();
      if (selected) {
        if (selected.method === 'bank_transfer') {
          return `Bank Transfer (${selected.card_info.brand}) ending in ${selected.card_info.last4}`;
        }
        return `${selected.card_info.brand} ending in ${selected.card_info.last4}`;
      }
      return 'Select your payment card to process refund';
    }
    if (pm === 'bank_transfer') return 'Bank Transfer';
    
    const card = order.payment.card_info;
    if (card) {
      return `${card.brand || 'Card'} ending in ${card.last4 || 'xxxx'}`;
    }
    return 'Original Payment Method';
  }

  getPaymentThumbnail(order: any): string {
    if (!order || !order.payment) return '';
    const pm = order.payment.method;
    
    if (pm === 'cod' || pm === 'qr') {
      const selected = this.selectedRefundPayment();
      if (selected) {
        if (selected.method === 'bank_transfer') return 'assets/images/payment_napas.png';
        const brand = (selected.card_info?.brand || '').toLowerCase();
        if (brand === 'visa') return 'assets/images/payment_visa.png';
        if (brand === 'mastercard') return 'assets/images/payment_mastercard.png';
        return 'assets/images/payment_napas.png';
      }
      return '';
    }
    
    if (pm === 'cod') {
      return '';
    }
    const card = order.payment.card_info;
    if (card && card.brand) {
      const brand = card.brand.toLowerCase();
      if (brand === 'visa') return 'assets/images/payment_visa.png';
      if (brand === 'mastercard') return 'assets/images/payment_mastercard.png';
      if (brand === 'napas') return 'assets/images/payment_napas.png';
    }
    return 'assets/images/payment_napas.png';
  }

  // Click handler on "Select your payment card to process refund"
  openPaymentModal() {
    const ord = this.order();
    if (!ord || (ord.payment?.method !== 'cod' && ord.payment?.method !== 'qr')) return;

    this.showRefundPaymentModal.set(true);

    if (this.savedCards().length > 0) {
      this.isAddingNew.set(false);
      // Pre-select active saved card
      const activeId = this.selectedSavedCardId();
      if (!activeId) {
        this.selectedSavedCardId.set(this.savedCards()[0]._id);
      }
    } else {
      this.openAddNewForm();
    }
  }

  closePaymentModal() {
    this.showRefundPaymentModal.set(false);
    this.teardownValidators();
    this.clearWindowHelpers();
  }

  openAddNewForm() {
    this.isAddingNew.set(true);
    this.selectedSavedCardId.set(null);
    // Reset Form
    this.cardForm = {
      card_type: 'credit',
      card_number: '',
      cardholder_name: '',
      expire_date: '',
      cvc: '',
      issued_bank: ''
    };
    this.cardFormTouched = {
      cardholder_name: false,
      card_number: false,
      expire_date: false,
      cvc: false,
      issued_bank: false
    };
    this.teardownValidators();
    this.setupWindowHelpers();
    if (this.modalPaymentMethod() === 'card') {
      this.setupCardValidator();
    } else {
      this.setupBankValidator();
    }
  }

  selectSavedCard(cardId: string) {
    this.selectedSavedCardId.set(cardId);
    this.isAddingNew.set(false);
    this.teardownValidators();
    this.clearWindowHelpers();
  }

  selectModalPaymentMethod(method: 'card' | 'bank_transfer') {
    this.modalPaymentMethod.set(method);
    this.cardForm.card_type = method === 'card' ? 'credit' : 'NAPAS';
    
    // Clear and reset forms
    this.cardForm = {
      card_type: method === 'card' ? 'credit' : 'NAPAS',
      card_number: '',
      cardholder_name: '',
      expire_date: '',
      cvc: '',
      issued_bank: ''
    };
    this.cardFormTouched = {
      cardholder_name: false,
      card_number: false,
      expire_date: false,
      cvc: false,
      issued_bank: false
    };
    
    this.teardownValidators();
    this.setupWindowHelpers();
    if (method === 'card') {
      this.setupCardValidator();
    } else {
      this.setupBankValidator();
    }
  }

  // Card Brand Detection
  get inlineCardBrand(): string | null {
    const digits = this.cardForm.card_number.replace(/\s+/g, '');
    if (this.modalPaymentMethod() === 'bank_transfer') return 'Napas';
    if (digits.startsWith('4')) return 'Visa';
    if (digits.startsWith('5') || digits.startsWith('2')) return 'Mastercard';
    return null;
  }

  // Get Brand for Saved Card
  getCardBrand(c: any): string {
    if (c.card_type === 'NAPAS') return 'napas';
    const num = (c.card_number || '').trim();
    if (num.startsWith('4')) return 'visa';
    return 'mastercard';
  }

  // Expiration check helper
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

  // Field level validation
  getFieldError(field: string): string | null {
    if (!this.cardFormTouched[field as keyof typeof this.cardFormTouched]) return null;

    const value = this.cardForm[field as keyof typeof this.cardForm] || '';
    const cleanVal = value.trim();

    if (field === 'cardholder_name') {
      if (!cleanVal) return 'Cardholder name is required.';
      if (cleanVal.split(/\s+/).filter(Boolean).length < 2) return 'Cardholder name must contain at least 2 words.';
      if (/[0-9]/.test(cleanVal)) return 'Cardholder name cannot contain numbers.';
    }

    if (field === 'card_number') {
      if (!cleanVal) return 'Card number is required.';
      const digits = cleanVal.replace(/\s+/g, '');
      if (/[^0-9]/.test(digits)) return 'Card number can only contain digits.';
      
      if (this.modalPaymentMethod() === 'bank_transfer') {
        if (!digits.startsWith('9704')) return 'NAPAS domestic card number must start with 9704.';
        if (digits.length < 16 || digits.length > 19) return 'Card number must be 16-19 digits.';
      } else {
        const isVisa = digits.startsWith('4') && (digits.length === 13 || digits.length === 16);
        const p2Val = parseInt(digits.slice(0, 2), 10);
        const prefix4 = parseInt(digits.slice(0, 4), 10);
        const isMaster = ((p2Val >= 51 && p2Val <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) && digits.length === 16;
        if (!isVisa && !isMaster) return 'Invalid card number format. Must be Visa or Mastercard.';
      }
    }

    if (field === 'expire_date') {
      if (!cleanVal) return 'Expiry date is required.';
      if (!/^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/.test(cleanVal)) return 'Expiry date must be in MM/YY format.';
      if (this.isCardExpired(cleanVal)) return 'Card has expired or expiry date is invalid.';
    }

    if (field === 'cvc' && this.modalPaymentMethod() === 'card') {
      if (!cleanVal) return 'CVV is required.';
      if (!/^\d{3}$/.test(cleanVal)) return 'CVV must be exactly 3 digits.';
    }

    if (field === 'issued_bank' && this.modalPaymentMethod() === 'bank_transfer') {
      if (!cleanVal) return 'Issued bank is required.';
      if (!this.bankList.includes(cleanVal)) return 'Please select a valid bank from the list.';
    }

    return null;
  }

  // Check if form is valid
  get isModalFormValid(): boolean {
    const requiredFields = this.modalPaymentMethod() === 'card' 
      ? ['cardholder_name', 'card_number', 'expire_date', 'cvc']
      : ['cardholder_name', 'card_number', 'expire_date', 'issued_bank'];

    let valid = true;
    for (const f of requiredFields) {
      const backup = this.cardFormTouched[f as keyof typeof this.cardFormTouched];
      this.cardFormTouched[f as keyof typeof this.cardFormTouched] = true;
      const error = this.getFieldError(f);
      this.cardFormTouched[f as keyof typeof this.cardFormTouched] = backup;
      
      if (error) {
        valid = false;
        break;
      }
    }
    return valid;
  }

  // Format Card Number (adds spaces)
  formatCardNumber() {
    let value = this.cardForm.card_number.replace(/\s+/g, '');
    let formatted = '';
    for (let i = 0; i < value.length; i += 4) {
      formatted += value.substring(i, i + 4) + ' ';
    }
    this.cardForm.card_number = formatted.trim();
  }

  // Format Cardholder Name (to uppercase)
  formatCardholderName() {
    this.cardForm.cardholder_name = this.cardForm.cardholder_name.toUpperCase();
  }

  // Touch handler
  touchField(field: string) {
    this.cardFormTouched[field as keyof typeof this.cardFormTouched] = true;
  }

  // Confirm selection
  confirmPaymentSelection() {
    if (this.isAddingNew() || this.savedCards().length === 0) {
      const activeValidator = this.modalPaymentMethod() === 'card' ? this.cardValidator : this.bankValidator;
      if (activeValidator && !activeValidator.validateAll()) {
        return;
      }

      const digits = this.cardForm.card_number.replace(/\s+/g, '');
      const last4 = digits.slice(-4);
      const brand = this.modalPaymentMethod() === 'bank_transfer' ? (this.cardForm.issued_bank || 'NAPAS') : (this.inlineCardBrand || 'Card');
      
      this.selectedRefundPayment.set({
        method: this.modalPaymentMethod(),
        card_info: {
          brand: brand,
          last4: last4,
          cardholder_name: this.cardForm.cardholder_name
        }
      });
    } else {
      const selectedId = this.selectedSavedCardId();
      const card = this.savedCards().find(c => c._id === selectedId);
      if (card) {
        this.selectedRefundPayment.set({
          method: card.card_type === 'NAPAS' ? 'bank_transfer' : 'card',
          card_info: {
            brand: card.card_type === 'NAPAS' ? (card.issued_bank || 'NAPAS') : (this.getCardBrand(card) === 'visa' ? 'Visa' : 'Mastercard'),
            last4: card.card_number.replace(/\s+/g, '').slice(-4),
            cardholder_name: card.cardholder_name
          }
        });
      }
    }
    this.showRefundPaymentModal.set(false);
    this.teardownValidators();
    this.clearWindowHelpers();
  }

  getCardThumbnail(c: any): string {
    const brand = this.getCardBrand(c);
    return `assets/images/payment_${brand}.png`;
  }

  private setupWindowHelpers(): void {
    if (typeof window === 'undefined') return;
    (window as any).getInlineCardType = () => this.cardForm.card_type;
    (window as any).validateCardNumberFormat = (value: string, type: string) => {
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
    (window as any).isCardExpiredCheck = (value: string) => {
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
    (window as any).isValidBank = (val: string) => VIETNAM_BANK_LIST.includes((val || '').trim());
  }

  private clearWindowHelpers(): void {
    if (typeof window === 'undefined') return;
    delete (window as any).getInlineCardType;
    delete (window as any).validateCardNumberFormat;
    delete (window as any).isCardExpiredCheck;
    delete (window as any).isValidBank;
  }

  private teardownValidators(): void {
    if (this.cardValidator) {
      this.cardValidator.detach();
      this.cardValidator = null;
    }
    if (this.bankValidator) {
      this.bankValidator.detach();
      this.bankValidator = null;
    }
  }

  private setupCardValidator(): void {
    setTimeout(() => {
      const cardConfigs: FieldConfig[] = [
        {
          field_id: 'refund-card-holder-name',
          error_element_id: 'refund-card-holder-name-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Cardholder name is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'value.trim().split(/\\s+/).filter(Boolean).length < 2', error_message: 'Cardholder name must contain full name (at least 2 words).' },
            { sequence: 3, type: 'FORMAT_CHECK', regex_pattern: '[0-9]', error_message: 'Cardholder name cannot contain numbers.' }
          ]
        },
        {
          field_id: 'refund-card-num',
          error_element_id: 'refund-card-num-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Card number is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', regex_pattern: '[^0-9\\s]', error_message: 'Card number can only contain digits and spaces.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.validateCardNumberFormat(value, window.getInlineCardType())', error_message: 'Invalid card number format for the selected card type.' }
          ]
        },
        {
          field_id: 'refund-card-expiry',
          error_element_id: 'refund-card-expiry-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Expiry date is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: '!/^(0[1-9]|1[0-2])\\s*\\/\\s*\\d{2}$/.test(value.trim())', error_message: 'Expiry date must be in MM/YY format.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.isCardExpiredCheck(value)', error_message: 'Card has expired or expiry date is invalid.' }
          ]
        },
        {
          field_id: 'refund-card-cvc',
          error_element_id: 'refund-card-cvc-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', condition: 'window.getInlineCardType() !== "NAPAS" && value.trim() === ""', error_message: 'CVV is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'window.getInlineCardType() !== "NAPAS" && !/^\\d{3}$/.test(value.trim())', error_message: 'CVV must be exactly 3 digits.' }
          ]
        }
      ];

      this.cardValidator = new InlineValidator(cardConfigs);
      this.cardValidator.attach();
    }, 100);
  }

  private setupBankValidator(): void {
    setTimeout(() => {
      const bankConfigs: FieldConfig[] = [
        {
          field_id: 'refund-bank-holder-name',
          error_element_id: 'refund-bank-holder-name-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Account holder name is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'value.trim().split(/\\s+/).filter(Boolean).length < 2', error_message: 'Must contain full name (at least 2 words).' },
            { sequence: 3, type: 'FORMAT_CHECK', regex_pattern: '[0-9]', error_message: 'Cannot contain numbers.' }
          ]
        },
        {
          field_id: 'refund-bank-num',
          error_element_id: 'refund-bank-num-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Card/Account number is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', regex_pattern: '[^0-9\\s]', error_message: 'Can only contain digits and spaces.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.validateCardNumberFormat(value, "NAPAS")', error_message: 'Invalid card number format.' }
          ]
        },
        {
          field_id: 'refund-bank-expiry',
          error_element_id: 'refund-bank-expiry-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Expiry date is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: '!/^(0[1-9]|1[0-2])\\s*\\/\\s*\\d{2}$/.test(value.trim())', error_message: 'Must be in MM/YY format.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.isCardExpiredCheck(value)', error_message: 'Card has expired or expiry date is invalid.' }
          ]
        },
        {
          field_id: 'refund-bank-issued',
          error_element_id: 'refund-bank-issued-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', condition: 'value.trim() === ""', error_message: 'Issued bank is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: '!window.isValidBank(value)', error_message: 'Invalid bank name. Please select from the list.' }
          ]
        }
      ];

      this.bankValidator = new InlineValidator(bankConfigs);
      this.bankValidator.attach();
    }, 100);
  }
}
