import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpService } from './http.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpService);

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
    const response = await this.http.post('/auth/login', {
      email: emailOrPhone,
      password
    });

    this.setAuthState(response);
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

    this.setAuthState(response);
    return response;
  }

  // GET PROFILE
  async getMe(): Promise<any> {
    return await this.http.get('/auth/profile');
  }

  async getSavedItems(): Promise<any> {
    return await this.http.get('/auth/saved-items');
  }

  async toggleSavedProduct(productId: number): Promise<{ saved: boolean; product_id: string }> {
    return await this.http.put(`/auth/saved-products/${productId}`, {});
  }

  async toggleSavedRecipe(recipeId: string): Promise<{ saved: boolean; recipe_id: string; saves: number }> {
    return await this.http.put(`/auth/saved-recipes/${recipeId}`, {});
  }

  // LOGOUT

  logout(): void {
    this.isAuthenticatedSignal.set(false);


    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
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

