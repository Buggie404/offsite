import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpService } from './http.service';
import { CartService } from '../features/purchase/services/cart.service';
import { Router } from '@angular/router';
import { OrderSocketService } from './services/order-socket.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpService);
  private cartService = inject(CartService);
  private router = inject(Router);
  private orderSocketService = inject(OrderSocketService);

  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  private currentUserSignal = signal<any>(null);
  readonly currentUser = this.currentUserSignal.asReadonly();

  constructor() {
    this.initAuthState();
  }

  initAuthState() {
    if (isPlatformBrowser(this.platformId)) {
      const token = localStorage.getItem('token');
      this.isAuthenticatedSignal.set(!!token);
      const user = this.getUser();
      this.currentUserSignal.set(user);
      if (token) {
        this.fetchUserProfile();
      }
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
    await this.fetchUserProfile();

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

  // FORGOT / RESET PASSWORD

  // Gửi OTP đặt lại mật khẩu về email hoặc phone (backend tự nhận diện loại identifier)
  async forgotPassword(identifier: string): Promise<any> {
    return await this.http.post('/auth/forgot-password', { identifier });
  }

  // Xác thực OTP + đặt mật khẩu mới trong cùng 1 lần gọi (theo đúng contract của backend)
  async resetPassword(identifier: string, otp: string, newPassword: string): Promise<any> {
    return await this.http.post('/auth/reset-password', { identifier, otp, newPassword });
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
    this.currentUserSignal.set(null);

    const currentUrl = this.router.url;

    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      this.orderSocketService.refreshTokenAuth();
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
      this.orderSocketService.refreshTokenAuth();
    }
    this.fetchUserProfile();
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

  setUser(user: any): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('user', JSON.stringify(user));
    }
    this.currentUserSignal.set(user);
  }

  async fetchUserProfile(): Promise<any> {
    try {
      const res: any = await this.getMe();
      if (res?.user) {
        this.setUser(res.user);
        return res.user;
      }
    } catch (e) {
      console.warn('Could not fetch user profile:', e);
    }
    return null;
  }

  private setAuthState(response: any) {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');

      localStorage.setItem('token', response.token);
      if (response.user) {
        localStorage.setItem('user', JSON.stringify(response.user));
        this.currentUserSignal.set(response.user);
      }

      if (response.refreshToken) {
        localStorage.setItem('refreshToken', response.refreshToken);
      }
      this.orderSocketService.refreshTokenAuth();
    }
    this.isAuthenticatedSignal.set(true);
    this.fetchUserProfile();
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