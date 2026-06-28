import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideX, LucideChevronDown, LucideCheck, LucideAlertCircle } from '@lucide/angular';
import { UserAddress } from '../../models/user.model';

@Component({
  selector: 'app-address-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideChevronDown, LucideCheck, LucideAlertCircle],
  templateUrl: './address-modal.component.html',
  styleUrl: './address-modal.component.scss'
})
export class AddressModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() address: UserAddress | null = null;
  @Input() isOnlyAddress = false;
  @Output() save = new EventEmitter<Omit<UserAddress, '_id'>>();
  @Output() cancel = new EventEmitter<void>();

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

  form = {
    recipient_name: '',
    phone: '',
    city: '',
    detail_address: '',
    label: null as 'home' | 'office' | 'other' | null,
    is_default: false
  };

  nameError = signal<string | null>(null);
  mobileError = signal<string | null>(null);
  cityError = signal<string | null>(null);
  addressError = signal<string | null>(null);

  fieldStates = signal<Record<string, 'idle' | 'typing' | 'valid' | 'invalid'>>({
    name: 'idle',
    mobile: 'idle',
    city: 'idle',
    address: 'idle'
  });

  showCitySuggestions = false;

  constructor() {
    this.populateRealCities();
  }

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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['address'] || changes['isOnlyAddress'] || changes['isOpen']) {
      this.reloadForm();
    }
  }

  reloadForm(): void {
    if (this.address) {
      this.form = {
        recipient_name: this.address.recipient_name || '',
        phone: this.address.phone || '',
        city: this.address.city || '',
        detail_address: this.address.detail_address || '',
        label: (this.address.label as 'home' | 'office' | 'other' | null) ?? null,
        is_default: this.isOnlyAddress ? true : !!this.address.is_default
      };
      setTimeout(() => {
        this.validateAllFieldsOnLoad();
      });
    } else {
      this.form = {
        recipient_name: '',
        phone: '',
        city: '',
        detail_address: '',
        label: null,
        is_default: this.isOnlyAddress ? true : false
      };
      this.resetValidation();
    }
  }

  validateName(): string | null {
    return this.form.recipient_name.trim() ? null : 'Name is required.';
  }

  validateMobile(): string | null {
    const val = this.form.phone;
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

  validateCity(): string | null {
    const val = this.form.city.trim();
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
    const val = this.normalizeString(this.form.city);
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
    this.form.city = city;
    this.showCitySuggestions = false;
    this.onFieldBlur('city');
  }

  validateAddress(): string | null {
    const val = this.form.detail_address.trim();
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

  onFieldInput(field: 'name' | 'mobile' | 'city' | 'address') {
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

  onFieldBlur(field: 'name' | 'mobile' | 'city' | 'address') {
    this.onFieldInput(field);
  }

  private getFieldValue(field: 'name' | 'mobile' | 'city' | 'address'): string {
    switch (field) {
      case 'name':
        return (this.form.recipient_name || '').trim();
      case 'mobile':
        return (this.form.phone || '').trim();
      case 'city':
        return (this.form.city || '').trim();
      case 'address':
        return (this.form.detail_address || '').trim();
      default:
        return '';
    }
  }

  private runValidation(field: 'name' | 'mobile' | 'city' | 'address'): string | null {
    switch (field) {
      case 'name':
        return this.validateName();
      case 'mobile':
        return this.validateMobile();
      case 'city':
        return this.validateCity();
      case 'address':
        return this.validateAddress();
      default:
        return null;
    }
  }

  private setFieldError(field: 'name' | 'mobile' | 'city' | 'address', error: string | null) {
    const errorSignal = (this as any)[`${field}Error`] as ReturnType<typeof signal<string | null>>;
    if (errorSignal && typeof errorSignal.set === 'function') {
      errorSignal.set(error);
    }
  }

  private setFieldState(field: 'name' | 'mobile' | 'city' | 'address', state: 'idle' | 'typing' | 'valid' | 'invalid') {
    this.fieldStates.update(states => ({
      ...states,
      [field]: state
    }));
  }

  private validateAllFieldsOnLoad() {
    const fields: ('name' | 'mobile' | 'city' | 'address')[] = [
      'name', 'mobile', 'city', 'address'
    ];
    for (const f of fields) {
      const error = this.runValidation(f);
      if (!error && this.getFieldValue(f)) {
        this.setFieldState(f, 'valid');
      } else {
        this.setFieldState(f, 'idle');
      }
    }
  }

  resetValidation() {
    this.nameError.set(null);
    this.mobileError.set(null);
    this.cityError.set(null);
    this.addressError.set(null);
    this.fieldStates.set({
      name: 'idle',
      mobile: 'idle',
      city: 'idle',
      address: 'idle'
    });
    this.showCitySuggestions = false;
  }

  selectLabel(label: 'home' | 'office' | 'other'): void {
    if (this.form.label === label) {
      this.form.label = null;
    } else {
      this.form.label = label;
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSave(): void {
    const fields: ('name' | 'mobile' | 'city' | 'address')[] = [
      'name', 'mobile', 'city', 'address'
    ];
    let hasError = false;
    for (const f of fields) {
      const error = this.runValidation(f);
      if (error) {
        this.setFieldError(f, error);
        this.setFieldState(f, 'invalid');
        hasError = true;
      } else {
        this.setFieldError(f, null);
        const currentVal = this.getFieldValue(f);
        this.setFieldState(f, currentVal ? 'valid' : 'idle');
      }
    }

    if (hasError) {
      return;
    }

    this.save.emit(this.form);
  }
}
