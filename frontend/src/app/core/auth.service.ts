import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpService } from './http.service';
import { CartService } from '../features/purchase/services/cart.service';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpService);
  private cartService = inject(CartService);
  private router = inject(Router);

  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor() {
    this.initAuthState();
  }

  initAuthState() {
    if (isPlatformBrowser(this.platformId)) {
      const token = localStorage.getItem('token');
      this.isAuthenticatedSignal.set(!!token);
    }
  }

  // LOGIN

  async login(emailOrPhone: string, password: string): Promise<any> {
    // Keep the guest cart so logout can restore it (merge is one-way).
    this.cartService.snapshotGuestCartForLogin();

    const response = await this.http.post('/auth/login', {
      email: emailOrPhone,
      password,
      guestCart: this.cartService.getGuestCartPayload()
    });

    this.setAuthState(response);

    // Overwrite the local cart with the authoritative user cart from the DB.
    if (response?.cart?.items) {
      this.cartService.replaceCartFromMerge(response.cart.items);
    }
    return response;
  }
  // REGISTER
  async register(data: {
    name: string;
    email: string;
    phone: string;
    password: string;
  }): Promise<any> {
    const response = await this.http.post('/auth/register', data);

    // this.setAuthState(response);
    return response;
  }
  
  async verifyRegistrationOtp(
    registration_id: string,
    otp: string
  ): Promise<any> {
    const response = await this.http.post(
      '/auth/verify-registration-otp',
      {
        registration_id,
        otp
      }
    );

    this.setAuthState(response);

    return response;
  }

  // Gửi lại OTP đăng ký — reset số lần sai + hạn dùng ở backend
  async resendRegistrationOtp(registration_id: string): Promise<any> {
    return await this.http.post('/auth/resend-registration-otp', { registration_id });
  }

  // GET PROFILE
  async getMe(): Promise<any> {
    return await this.http.get('/auth/profile');
  }

  async getSavedItems(): Promise<any> {
    return await this.http.get('/auth/saved-items');
  }

  async toggleSavedProduct(productId: number): Promise<{ saved: boolean; message?: string }> {
    return await this.http.post('/auth/saved-products', { productId });
  }

  async toggleSavedRecipe(recipeId: string): Promise<{ saved: boolean; message?: string }> {
    return await this.http.post('/auth/saved-recipes', { recipeId });
  }

  // LOGOUT

  logout(): void {
    this.isAuthenticatedSignal.set(false);

    const currentUrl = this.router.url;

    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }

    // Restore the guest cart captured at login; the user cart stays in the DB.
    this.cartService.restoreGuestCartOnLogout();

    if (
      currentUrl.startsWith('/community') ||
      currentUrl.startsWith('/account')
    ) {
      this.router.navigate(['/']);
    }
  }

  // OAUTH SUCCESS

  handleOAuthSuccess(token: string): void {
    this.isAuthenticatedSignal.set(true);

    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('token', token);

      try {
        const payload = JSON.parse(atob(token.split('.')[1]));

        const user = {
          _id: payload.user_id,
          user_id: payload.user_id,
          email: payload.email,
          role: payload.role
        };

        localStorage.setItem('user', JSON.stringify(user));
      } catch (e) {
        console.error('Failed to parse OAuth token:', e);
      }
    }
  }

  // Merge the guest cart after an OAuth login. The redirect callback can't
  // carry the cart, so the client triggers the merge once it holds the token.
  async mergeGuestCartAfterOAuth(): Promise<void> {
    try {
      // Keep the guest cart so logout can restore it (merge is one-way).
      this.cartService.snapshotGuestCartForLogin();

      // Always call: with items it merges; with none the backend returns the
      // user's existing DB cart so we still hydrate it.
      const items = this.cartService.getGuestCartPayload();
      const res: any = await this.http.post('/cart/merge', { items });
      if (res?.cart?.items) {
        this.cartService.replaceCartFromMerge(res.cart.items);
      }
    } catch (e) {
      console.error('OAuth cart merge failed:', e);
    }
  }

  // PRIVATE

  private setAuthState(response: any) {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');

      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));

      if (response.refreshToken) {
        localStorage.setItem('refreshToken', response.refreshToken);
      }
    }
    this.isAuthenticatedSignal.set(true);
  }

  getUser(): any {
    if (isPlatformBrowser(this.platformId)) {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          return JSON.parse(u);
        } catch (e) {}
      }
    }
    return null;
  }
}