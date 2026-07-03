import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Product, ProductVariant } from '../../../shared/models/product.model';
import { Voucher } from '../../../shared/models/voucher.model';
import { UserAddress, UserPaymentMethod, UserProfile } from '../../../shared/models/user.model';

export interface CheckoutItem {
  product: Product;
  variantSku: string;
  quantity: number;
  isComplement?: boolean;
}

export interface DeliveryInfo {
  name: string;
  mobile: string;
  email: string;
  city: string;
  address: string;
  note: string;
}

export type ShippingMethod = 'fast' | 'express';
export type PaymentMethod = 'cod' | 'qr' | 'bank_transfer' | 'card';

export class VoucherFetchError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'VoucherFetchError';
  }
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private http = inject(HttpClient);

  private productsCache: Product[] | null = null;

  async getAllProducts(): Promise<Product[]> {
    if (this.productsCache) return this.productsCache;
    const products = await firstValueFrom(this.http.get<Product[]>('/api/products'));
    this.productsCache = products;
    return products;
  }

  /**
   * Mock cart: cart flow not built yet. Treat 2 random in-stock products as
   * the user's is_selected = true items.
   */
  async getMockCartItems(): Promise<CheckoutItem[]> {
    const products = await this.getAllProducts();
    const candidates = products.filter(p => p.is_active && p.variants?.length);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2).map(p => {
      const variant = p.variants.find(v => v.is_default) ?? p.variants[0];
      return { product: p, variantSku: variant.sku, quantity: 1 };
    });
  }

  getVariant(product: Product, sku: string): ProductVariant {
    return product.variants.find(v => v.sku === sku) ?? product.variants[0];
  }

  buildComplements(cartItems: CheckoutItem[], allProducts: Product[]): Product[] {
    if (!cartItems.length) return [];

    const dominant = cartItems[0].product.category;
    const cartIds = new Set(cartItems.map(i => i.product._id));
    const pool = allProducts.filter(
      p => p.is_active && !cartIds.has(p._id) && p.variants?.length
    );

    const used = new Set<string>();
    const result: Product[] = [];

    const take = (candidates: Product[], n: number) => {
      const fresh = candidates.filter(p => !used.has(p._id));
      const shuffled = [...fresh].sort(() => Math.random() - 0.5);
      for (const p of shuffled.slice(0, n)) {
        used.add(p._id);
        result.push(p);
      }
    };

    if (dominant === 'matcha') {
      take(pool.filter(p => p.category === 'tools' && p.tools?.tool_category === 'matcha-tools'), 1);
      take(pool.filter(p => p.category === 'drinkware' && (p.drinkware?.material ?? '').toLowerCase().includes('ceramic')), 1);
      take(pool.filter(p => p.category === 'matcha'), 1);
    } else if (dominant === 'coffee') {
      take(pool.filter(p => p.category === 'tools' && p.tools?.tool_category === 'coffee-tools'), 1);
      take(pool.filter(p => p.category === 'drinkware'), 1);
      take(pool.filter(p => p.category === 'coffee'), 1);
    } else if (dominant === 'sets_bundles') {
      const currentTags = new Set(cartItems.flatMap(i => i.product.product_tag ?? []));
      take(
        pool.filter(
          p =>
            p.category === 'sets_bundles' &&
            (p.product_tag ?? []).every(t => !currentTags.has(t))
        ),
        3
      );
    }

    /* Fallback: if specific filters missed items in the DB, top up to 3 with
       same-category products first, then anything in the pool. Avoids empty
       suggestions when the seeded data doesn't cover every rule. */
    if (result.length < 3) {
      take(pool.filter(p => p.category === dominant), 3 - result.length);
    }
    if (result.length < 3) {
      take(pool, 3 - result.length);
    }

    return result;
  }

  /** Fetch a voucher by code. Throws `VoucherNotFoundError` for 404. */
  async fetchVoucher(code: string): Promise<Voucher> {
    const normalized = encodeURIComponent(code.trim().toUpperCase());
    try {
      return await firstValueFrom(
        this.http.get<Voucher>(`/api/vouchers/${normalized}`)
      );
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        const message = err.error?.error ?? 'Voucher request failed';
        throw new VoucherFetchError(message, err.status);
      }
      throw err;
    }
  }

  /** Fetch all active vouchers from the backend. */
  async getVouchers(): Promise<Voucher[]> {
    try {
      return await firstValueFrom(
        this.http.get<Voucher[]>('/api/vouchers')
      );
    } catch (err) {
      console.error('Failed to fetch vouchers:', err);
      return [];
    }
  }

  /** Pick a single replacement suggestion that follows the same category rules
   *  and isn't already in the cart or currently shown. */
  pickComplementReplacement(
    cartItems: CheckoutItem[],
    allProducts: Product[],
    excludeIds: Set<string>
  ): Product | null {
    const filtered = allProducts.filter(p => !excludeIds.has(p._id));
    const picks = this.buildComplements(cartItems, filtered);
    return picks[0] ?? null;
  }

  async getUserProfile(): Promise<UserProfile> {
    const res = await firstValueFrom(
      this.http.get<{ user: UserProfile }>('/api/auth/profile')
    );
    return res.user;
  }

  async getOrderHistory(): Promise<any[]> {
    return await firstValueFrom(
      this.http.get<any[]>('/api/orders')
    );
  }

  async addUserAddress(address: Omit<UserAddress, '_id'>): Promise<{ message: string; address: UserAddress }> {
    return await firstValueFrom(
      this.http.post<{ message: string; address: UserAddress }>('/api/auth/addresses', address)
    );
  }

  async updateUserAddress(id: string, address: Partial<UserAddress>): Promise<{ message: string; address: UserAddress }> {
    return await firstValueFrom(
      this.http.put<{ message: string; address: UserAddress }>(`/api/auth/addresses/${id}`, address)
    );
  }

  async deleteUserAddress(id: string): Promise<any> {
    return await firstValueFrom(
      this.http.delete<any>(`/api/auth/addresses/${id}`)
    );
  }

  async addUserPaymentMethod(card: Omit<UserPaymentMethod, '_id'>): Promise<{ message: string; payment_method: UserPaymentMethod }> {
    return await firstValueFrom(
      this.http.post<{ message: string; payment_method: UserPaymentMethod }>('/api/auth/payment-methods', card)
    );
  }

  async deleteUserPaymentMethod(id: string): Promise<any> {
    return await firstValueFrom(
      this.http.delete<any>(`/api/auth/payment-methods/${id}`)
    );
  }

  async submitOrder(payload: any): Promise<any> {
    return await firstValueFrom(
      this.http.post<any>('/api/orders', payload)
    );
  }

  async requestRefund(id: string, payload: any): Promise<any> {
    return await firstValueFrom(
      this.http.post<any>(`/api/orders/${id}/refund`, payload)
    );
  }

  async confirmOrder(id: string, sessionId?: string | null): Promise<any> {
    return await firstValueFrom(
      this.http.put<any>(`/api/orders/${id}/confirm`, { session_id: sessionId })
    );
  }

  async cancelOrder(id: string, sessionId?: string | null): Promise<any> {
    return await firstValueFrom(
      this.http.put<any>(`/api/orders/${id}/cancel`, { session_id: sessionId })
    );
  }

  async failPayment(id: string, sessionId?: string | null): Promise<any> {
    return await firstValueFrom(
      this.http.put<any>(`/api/orders/${id}/fail-payment`, { session_id: sessionId })
    );
  }

  async confirmPayment(id: string, sessionId?: string | null): Promise<any> {
    return await firstValueFrom(
      this.http.put<any>(`/api/orders/${id}/confirm-payment`, { session_id: sessionId })
    );
  }

  async trackOrder(orderId: string, verificationValue: string, isEmail: boolean): Promise<any> {
    const params: { [param: string]: string } = { order_id: orderId };
    if (isEmail) {
      params['email'] = verificationValue;
    } else {
      params['mobile'] = verificationValue;
    }
    return await firstValueFrom(
      this.http.get<any>('/api/order-tracking', { params })
    );
  }

  async getOrderStatus(id: string, sessionId?: string | null): Promise<any> {
    const params: { [param: string]: string } = {};
    if (sessionId) {
      params['session_id'] = sessionId;
    }
    return await firstValueFrom(
      this.http.get<any>(`/api/orders/${id}/status`, { params })
    );
  }

  async receiveOrder(
    id: string, 
    sessionId?: string | null, 
    verification?: { email?: string; mobile?: string }
  ): Promise<any> {
    return await firstValueFrom(
      this.http.put<any>(`/api/orders/${id}/receive`, { 
        session_id: sessionId, 
        ...verification 
      })
    );
  }

  async submitReview(payload: {
    order_id: string;
    product_id: string;
    variant_id: string;
    rating: number;
    content?: string;
    is_anonymous?: boolean;
  }): Promise<any> {
    return await firstValueFrom(
      this.http.post<any>('/api/reviews', payload)
    );
  }
}
