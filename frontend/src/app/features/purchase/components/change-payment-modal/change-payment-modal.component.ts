import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideX,
  LucideCheck,
  LucideBanknote,
  LucideQrCode,
  LucideLandmark,
  LucideCreditCard,
  LucideTrash2
} from '@lucide/angular';
import { CheckoutService, PaymentMethod } from '../../services/checkout.service';
import { AuthService } from '../../../../core/auth.service';
import { UserPaymentMethod } from '../../../../shared/models/user.model';
import { InlineValidator, FieldConfig } from '../../../../shared/utils/inline-validator';

const VIETNAM_BANK_LIST = ['Vietcombank', 'BIDV', 'Techcombank', 'VietinBank', 'Agribank', 'MB Bank', 'VPBank', 'ACB', 'Sacombank', 'TPBank', 'VIB', 'SHB', 'MSB', 'SeABank'];

@Component({
  selector: 'app-change-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideCheck, LucideBanknote, LucideQrCode, LucideLandmark, LucideCreditCard, LucideTrash2],
  templateUrl: './change-payment-modal.component.html',
  styleUrl: './change-payment-modal.component.scss'
})
export class ChangePaymentModalComponent implements OnChanges, OnDestroy {
  private checkoutService = inject(CheckoutService);
  authService = inject(AuthService);

  @Input() isOpen = false;
  @Input() orderId: string | null = null;
  @Input() sessionId: string | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() changed = new EventEmitter<{ order: any; method: PaymentMethod }>();

  readonly bankList = VIETNAM_BANK_LIST;

  paymentMethod = signal<PaymentMethod>('cod');
  savedCards = signal<UserPaymentMethod[]>([]);
  selectedCardId = signal<string | null>(null);
  showInlineCardForm = signal(false);
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  get savedCreditCards(): UserPaymentMethod[] {
    return this.savedCards().filter(c => c.card_type !== 'NAPAS');
  }

  get savedNapasCards(): UserPaymentMethod[] {
    return this.savedCards().filter(c => c.card_type === 'NAPAS');
  }

  cardForm = {
    card_type: 'credit' as 'credit' | 'debit' | 'NAPAS',
    card_number: '',
    cardholder_name: '',
    expire_date: '',
    cvc: '',
    issued_bank: '',
    is_default: false
  };

  bankForm = {
    card_number: '',
    cardholder_name: '',
    expire_date: '',
    issued_bank: ''
  };

  private cardValidator: InlineValidator | null = null;
  private bankValidator: InlineValidator | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.resetState();
      } else {
        this.teardownValidators();
        this.clearWindowHelpers();
      }
    }
  }

  ngOnDestroy(): void {
    this.teardownValidators();
    this.clearWindowHelpers();
  }

  private async resetState(): Promise<void> {
    this.errorMessage.set(null);
    this.loading.set(false);
    this.paymentMethod.set('cod');
    this.selectedCardId.set(null);
    this.showInlineCardForm.set(false);
    this.savedCards.set([]);
    this.cardForm = { card_type: 'credit', card_number: '', cardholder_name: '', expire_date: '', cvc: '', issued_bank: '', is_default: false };
    this.bankForm = { card_number: '', cardholder_name: '', expire_date: '', issued_bank: '' };
    this.teardownValidators();
    this.setupWindowHelpers();

    if (this.authService.isAuthenticated()) {
      try {
        const profile = await this.checkoutService.getUserProfile();
        const cards = (profile.payment_methods || []).slice().sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
        this.savedCards.set(cards);
      } catch (err) {
        console.error('Failed to load saved cards:', err);
      }
    }
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

  selectPayment(id: PaymentMethod): void {
    this.paymentMethod.set(id);
    this.errorMessage.set(null);
    this.showInlineCardForm.set(false);

    if (id === 'bank_transfer') {
      this.setupBankValidator();
      const defaultNapas = this.savedNapasCards.find(c => c.is_default && !this.isCardExpired(c.expire_date))
        || this.savedNapasCards.find(c => !this.isCardExpired(c.expire_date));
      this.selectedCardId.set(defaultNapas?._id || null);
    } else if (this.bankValidator) {
      this.bankValidator.detach();
      this.bankValidator = null;
    }

    if (id === 'card') {
      if (this.savedCreditCards.length === 0) {
        this.cardForm.card_type = 'credit';
        this.setupCardValidator();
      } else {
        const defaultCredit = this.savedCreditCards.find(c => c.is_default && !this.isCardExpired(c.expire_date))
          || this.savedCreditCards.find(c => !this.isCardExpired(c.expire_date));
        this.selectedCardId.set(defaultCredit?._id || null);
      }
    } else if (this.cardValidator) {
      this.cardValidator.detach();
      this.cardValidator = null;
    }
  }

  selectSavedCard(card: UserPaymentMethod): void {
    if (this.isCardExpired(card.expire_date)) return;
    this.showInlineCardForm.set(false);
    this.selectedCardId.set(card._id || null);
  }

  openAddCardModal(): void {
    this.selectedCardId.set(null);
    this.showInlineCardForm.set(true);

    if (this.paymentMethod() === 'bank_transfer') {
      this.bankForm = {
        card_number: '',
        cardholder_name: '',
        expire_date: '',
        issued_bank: ''
      };
      this.setupBankValidator();
    } else {
      this.cardForm = {
        card_type: 'credit',
        card_number: '',
        cardholder_name: '',
        expire_date: '',
        cvc: '',
        issued_bank: '',
        is_default: this.savedCreditCards.length === 0
      };
      this.setupCardValidator();
    }
  }

  cancelAddCard(): void {
    this.showInlineCardForm.set(false);
    if (this.cardValidator) {
      this.cardValidator.detach();
      this.cardValidator = null;
    }
    if (this.bankValidator) {
      this.bankValidator.detach();
      this.bankValidator = null;
    }
  }

  async saveCard(): Promise<void> {
    if (this.cardValidator && !this.cardValidator.validateAll()) return;
    if (!this.isCardFormValid) return;

    try {
      this.loading.set(true);
      const res = await this.checkoutService.addUserPaymentMethod(this.cardForm);
      const profile = await this.checkoutService.getUserProfile();
      const cards = (profile.payment_methods || []).slice().sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
      this.savedCards.set(cards);
      if (res.payment_method?._id) {
        this.selectedCardId.set(res.payment_method._id);
      }
      this.showInlineCardForm.set(false);
      if (this.cardValidator) {
        this.cardValidator.detach();
        this.cardValidator = null;
      }
    } catch (err) {
      console.error('Failed to save card:', err);
      this.errorMessage.set('Failed to save card. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async saveNapasCard(): Promise<void> {
    if (this.bankValidator && !this.bankValidator.validateAll()) return;
    if (!this.isBankFormValid) return;

    try {
      this.loading.set(true);
      const cleanNum = this.bankForm.card_number.replace(/\s+/g, '');
      const napasCardPayload = {
        card_type: 'NAPAS' as const,
        card_number: cleanNum,
        cardholder_name: this.bankForm.cardholder_name,
        expire_date: this.bankForm.expire_date,
        cvc: '',
        issued_bank: this.bankForm.issued_bank,
        is_default: this.savedNapasCards.length === 0
      };
      const res = await this.checkoutService.addUserPaymentMethod(napasCardPayload);
      const profile = await this.checkoutService.getUserProfile();
      const cards = (profile.payment_methods || []).slice().sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
      this.savedCards.set(cards);
      if (res.payment_method?._id) {
        this.selectedCardId.set(res.payment_method._id);
      }
      this.showInlineCardForm.set(false);
      if (this.bankValidator) {
        this.bankValidator.detach();
        this.bankValidator = null;
      }
    } catch (err) {
      console.error('Failed to save Napas card:', err);
      this.errorMessage.set('Failed to save bank card. Please try again.');
    } finally {
      this.loading.set(false);
    }
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
      is_default: this.savedCards().length === 0
    };
  }

  get inlineCardBrand(): string | null {
    if (this.cardForm.card_type === 'NAPAS') return 'Napas';
    const digits = this.cardForm.card_number.replace(/\s+/g, '');
    if (digits.startsWith('4')) return 'Visa';
    if (digits.startsWith('5') || digits.startsWith('2')) return 'Mastercard';
    return null;
  }

  formatCardholderName(): void {
    if (!this.cardForm.cardholder_name) return;
    if (this.cardValidator && this.cardValidator.validateField('card-holder-name')) {
      this.cardForm.cardholder_name = this.cardForm.cardholder_name
        .toUpperCase()
        .replace(/[^A-Z\s]/g, '');
    }
  }

  formatCardNumber(): void {
    if (!this.cardForm.card_number) return;
    if (this.cardValidator && this.cardValidator.validateField('card-num')) {
      const clean = this.cardForm.card_number.replace(/\s+/g, '');
      this.cardForm.card_number = clean.replace(/(.{4})/g, '$1 ').trim();
    }
  }

  formatBankholderName(): void {
    this.bankForm.cardholder_name = this.bankForm.cardholder_name.toUpperCase().replace(/[^A-Z\s]/g, '');
  }

  formatBankNumber(): void {
    const digits = this.bankForm.card_number.replace(/\s+/g, '');
    this.bankForm.card_number = digits.replace(/(.{4})/g, '$1 ').trim();
  }

  isValidBankLocal(val: string): boolean {
    return VIETNAM_BANK_LIST.includes((val || '').trim());
  }

  get isCardFormValid(): boolean {
    const c = this.cardForm;
    const cardholderName = c.cardholder_name || '';
    if (!cardholderName.trim() || cardholderName.trim().split(/\s+/).filter(Boolean).length < 2 || /[0-9]/.test(cardholderName)) {
      return false;
    }
    const cardNumClean = (c.card_number || '').replace(/\s+/g, '');
    if (!cardNumClean || /[^0-9]/.test(cardNumClean)) return false;
    if (c.card_type === 'NAPAS') {
      if (!cardNumClean.startsWith('9704') || cardNumClean.length < 16 || cardNumClean.length > 19) return false;
    } else {
      const isVisa = cardNumClean.startsWith('4') && (cardNumClean.length === 13 || cardNumClean.length === 16);
      const p2Val = parseInt(cardNumClean.slice(0, 2), 10);
      const prefix4 = parseInt(cardNumClean.slice(0, 4), 10);
      const isMaster = ((p2Val >= 51 && p2Val <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) && cardNumClean.length === 16;
      if (!isVisa && !isMaster) return false;
    }
    const cleanExp = (c.expire_date || '').trim();
    const matchExp = cleanExp.match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    if (!matchExp) return false;
    const expMonth = parseInt(matchExp[1], 10);
    const expYear = parseInt('20' + matchExp[2], 10);
    const now = new Date();
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) return false;
    if (c.card_type !== 'NAPAS') {
      const cvcClean = (c.cvc || '').trim();
      if (!cvcClean || !/^\d{3,4}$/.test(cvcClean)) return false;
    } else {
      if (!(c.issued_bank || '').trim() || !this.isValidBankLocal(c.issued_bank)) return false;
    }
    return true;
  }

  get isBankFormValid(): boolean {
    const b = this.bankForm;
    const cardholderName = b.cardholder_name || '';
    if (!cardholderName.trim() || cardholderName.trim().split(/\s+/).filter(Boolean).length < 2 || /[0-9]/.test(cardholderName)) {
      return false;
    }
    const cardNumClean = (b.card_number || '').replace(/\s+/g, '');
    if (!cardNumClean || /[^0-9]/.test(cardNumClean)) return false;
    if (!cardNumClean.startsWith('9704') || cardNumClean.length < 16 || cardNumClean.length > 19) return false;
    const cleanExp = (b.expire_date || '').trim();
    const matchExp = cleanExp.match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    if (!matchExp) return false;
    const expMonth = parseInt(matchExp[1], 10);
    const expYear = parseInt('20' + matchExp[2], 10);
    const now = new Date();
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) return false;
    if (!(b.issued_bank || '').trim() || !this.isValidBankLocal(b.issued_bank)) return false;
    return true;
  }

  get isConfirmDisabled(): boolean {
    if (this.loading()) return true;
    const method = this.paymentMethod();
    if (method === 'cod' || method === 'qr') return false;
    if (method === 'card') {
      if (this.showInlineCardForm() || this.savedCreditCards.length === 0) {
        return !this.isCardFormValid;
      }
      return !this.selectedCardId();
    }
    if (method === 'bank_transfer') {
      if (this.showInlineCardForm() || this.savedNapasCards.length === 0) {
        return !this.isBankFormValid;
      }
      return !this.selectedCardId();
    }
    return false;
  }

  isCardExpired(expireDate: string): boolean {
    if (!expireDate) return false;
    const parts = expireDate.split('/');
    if (parts.length !== 2) return false;
    const expMonth = parseInt(parts[0], 10);
    const expYear = parseInt('20' + parts[1], 10);
    const now = new Date();
    if (now.getFullYear() > expYear) return true;
    if (now.getFullYear() === expYear && now.getMonth() + 1 > expMonth) return true;
    return false;
  }

  getCardBrand(c: UserPaymentMethod): 'visa' | 'mastercard' | 'napas' {
    if (c.card_type === 'NAPAS') return 'napas';
    const num = (c.card_number || '').trim();
    if (num.startsWith('4')) return 'visa';
    const p2Val = parseInt(num.slice(0, 2), 10);
    const prefix4 = parseInt(num.slice(0, 4), 10);
    if ((p2Val >= 51 && p2Val <= 55) || (prefix4 >= 2221 && prefix4 <= 2720)) return 'mastercard';
    return 'visa';
  }

  getCardThumbnail(c: UserPaymentMethod): string {
    return `assets/images/payment_${this.getCardBrand(c)}.png`;
  }

  getCardLabel(c: UserPaymentMethod): string {
    const brand = this.getCardBrand(c);
    const typeName = brand === 'napas' ? 'Napas' : brand === 'mastercard' ? 'Mastercard' : 'Visa';
    return `${typeName} **${(c.card_number || '').slice(-4)}`;
  }

  async deleteCard(card: UserPaymentMethod, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this payment card?')) return;
    if (!card._id) return;

    try {
      await this.checkoutService.deleteUserPaymentMethod(card._id);
      if (this.selectedCardId() === card._id) {
        this.selectedCardId.set(null);
      }
      const profile = await this.checkoutService.getUserProfile();
      this.savedCards.set(profile.payment_methods || []);
    } catch (err) {
      console.error('Failed to delete card:', err);
      alert('Failed to delete card.');
    }
  }

  onClose(): void {
    this.close.emit();
  }

  async confirm(): Promise<void> {
    if (this.isConfirmDisabled) return;
    this.errorMessage.set(null);
    const method = this.paymentMethod();

    const paymentPayload: any = { method };

    if (method === 'card') {
      if (this.showInlineCardForm() || this.savedCreditCards.length === 0) {
        if (this.cardValidator && !this.cardValidator.validateAll()) return;
        const cleanNum = this.cardForm.card_number.replace(/\s+/g, '');
        let brand = 'Visa';
        if (this.cardForm.card_type === 'NAPAS') brand = 'Napas';
        else if (cleanNum.startsWith('5') || cleanNum.startsWith('2')) brand = 'Mastercard';

        paymentPayload.card_info = { brand, last4: cleanNum.slice(-4) };
        paymentPayload.full_card_info = {
          card_type: this.cardForm.card_type,
          card_number: cleanNum,
          cardholder_name: this.cardForm.cardholder_name,
          expire_date: this.cardForm.expire_date,
          cvc: this.cardForm.cvc,
          issued_bank: this.cardForm.issued_bank,
          is_default: this.savedCreditCards.length === 0
        };
      } else {
        const selectedCard = this.savedCards().find(c => c._id === this.selectedCardId());
        if (!selectedCard) {
          this.errorMessage.set('Please select a card or add a new one.');
          return;
        }
        let brand = 'Visa';
        if (selectedCard.card_type === 'NAPAS') brand = 'Napas';
        else if (selectedCard.card_number.startsWith('5') || selectedCard.card_number.startsWith('2')) brand = 'Mastercard';
        paymentPayload.card_info = { brand, last4: selectedCard.card_number.slice(-4) };
      }
    } else if (method === 'bank_transfer') {
      if (this.showInlineCardForm() || this.savedNapasCards.length === 0) {
        if (this.bankValidator && !this.bankValidator.validateAll()) return;
        const cleanNum = this.bankForm.card_number.replace(/\s+/g, '');
        paymentPayload.card_info = { brand: 'Napas', last4: cleanNum.slice(-4) };
        paymentPayload.full_card_info = {
          card_type: 'NAPAS',
          card_number: cleanNum,
          cardholder_name: this.bankForm.cardholder_name,
          expire_date: this.bankForm.expire_date,
          issued_bank: this.bankForm.issued_bank,
          is_default: false
        };
      } else {
        const selectedCard = this.savedCards().find(c => c._id === this.selectedCardId());
        if (!selectedCard) {
          this.errorMessage.set('Please select a card or add a new one.');
          return;
        }
        paymentPayload.card_info = { brand: 'Napas', last4: selectedCard.card_number.slice(-4) };
      }
    }

    if (!this.orderId) return;

    this.loading.set(true);
    try {
      const res = await this.checkoutService.changePaymentMethod(this.orderId, paymentPayload, this.sessionId);
      this.changed.emit({ order: res.data, method });
    } catch (err: any) {
      console.error('Failed to change payment method:', err);
      this.errorMessage.set(err.error?.error || 'Failed to update payment method. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  private setupCardValidator(): void {
    setTimeout(() => {
      const cardConfigs: FieldConfig[] = [
        {
          field_id: 'change-card-holder-name',
          error_element_id: 'change-card-holder-name-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Cardholder name is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'value.trim().split(/\\s+/).filter(Boolean).length < 2', error_message: 'Cardholder name must contain full name (at least 2 words).' },
            { sequence: 3, type: 'FORMAT_CHECK', regex_pattern: '[0-9]', error_message: 'Cardholder name cannot contain numbers.' }
          ]
        },
        {
          field_id: 'change-card-num',
          error_element_id: 'change-card-num-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Card number is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', regex_pattern: '[^0-9\\s]', error_message: 'Card number can only contain digits and spaces.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.validateCardNumberFormat(value, window.getInlineCardType())', error_message: 'Invalid card number format for the selected card type.' }
          ]
        },
        {
          field_id: 'change-card-expiry',
          error_element_id: 'change-card-expiry-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Expiry date is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: '!/^(0[1-9]|1[0-2])\\s*\\/\\s*\\d{2}$/.test(value.trim())', error_message: 'Expiry date must be in MM/YY format.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.isCardExpiredCheck(value)', error_message: 'Card has expired or expiry date is invalid.' }
          ]
        },
        {
          field_id: 'change-card-cvc',
          error_element_id: 'change-card-cvc-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', condition: 'window.getInlineCardType() !== "NAPAS" && value.trim() === ""', error_message: 'CVV is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'window.getInlineCardType() !== "NAPAS" && !/^\\d{3}$/.test(value.trim())', error_message: 'CVV must be exactly 3 digits.' }
          ]
        },
        {
          field_id: 'change-card-bank',
          error_element_id: 'change-card-bank-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', condition: 'window.getInlineCardType() === "NAPAS" && value.trim() === ""', error_message: 'Issued bank is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'window.getInlineCardType() === "NAPAS" && !window.isValidBank(value)', error_message: 'Invalid bank name. Please select from the list.' }
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
          field_id: 'change-bank-holder-name',
          error_element_id: 'change-bank-holder-name-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Account holder name is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: 'value.trim().split(/\\s+/).filter(Boolean).length < 2', error_message: 'Must contain full name (at least 2 words).' },
            { sequence: 3, type: 'FORMAT_CHECK', regex_pattern: '[0-9]', error_message: 'Cannot contain numbers.' }
          ]
        },
        {
          field_id: 'change-bank-num',
          error_element_id: 'change-bank-num-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Card number is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', regex_pattern: '[^0-9\\s]', error_message: 'Can only contain digits and spaces.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.validateCardNumberFormat(value, "NAPAS")', error_message: 'Invalid card number format.' }
          ]
        },
        {
          field_id: 'change-bank-expiry',
          error_element_id: 'change-bank-expiry-error',
          rules: [
            { sequence: 1, type: 'FORMAT_CHECK', regex_pattern: '^\\s*$', error_message: 'Expiry date is required.' },
            { sequence: 2, type: 'FORMAT_CHECK', condition: '!/^(0[1-9]|1[0-2])\\s*\\/\\s*\\d{2}$/.test(value.trim())', error_message: 'Must be in MM/YY format.' },
            { sequence: 3, type: 'FORMAT_CHECK', condition: 'window.isCardExpiredCheck(value)', error_message: 'Card has expired or expiry date is invalid.' }
          ]
        },
        {
          field_id: 'change-bank-issued',
          error_element_id: 'change-bank-issued-error',
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
