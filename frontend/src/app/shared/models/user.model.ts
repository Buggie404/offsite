export interface UserAddress {
  _id?: string;
  recipient_name: string;
  phone: string;
  city: string;
  detail_address: string;
  label?: 'home' | 'office' | 'other' | null;
  is_default?: boolean;
}

export interface UserPaymentMethod {
  _id?: string;
  card_type: 'NAPAS' | 'credit' | 'debit';
  card_number: string;
  cardholder_name: string;
  expire_date: string;
  issued_bank?: string | null;
  cvc?: string | null;
  is_default?: boolean;
}

export interface UserProfile {
  _id: string;
  user_id: string;
  email: string;
  phone?: string;
  profile_name: string;
  role: string;
  addresses: UserAddress[];
  payment_methods: UserPaymentMethod[];
}
