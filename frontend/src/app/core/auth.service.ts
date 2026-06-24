import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);
  
  // Reactive sign-in signal
  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const token = localStorage.getItem('token');
      this.isAuthenticatedSignal.set(!!token);
    }
  }

  async login(emailOrPhone: string, password: string): Promise<any> {
    const response = await firstValueFrom(
      this.http.post<any>('/api/auth/login', { email: emailOrPhone, password })
    );
    this.isAuthenticatedSignal.set(true);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
    }
    return response;
  }

  async register(data: { name: string; email: string; phone: string; password: string }): Promise<any> {
    const response = await firstValueFrom(
      this.http.post<any>('/api/auth/register', data)
    );
    this.isAuthenticatedSignal.set(true);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('token', response.token);
      localStorage.setItem('user', JSON.stringify(response.user));
    }
    return response;
  }

  logout(): void {
    this.isAuthenticatedSignal.set(false);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }

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
}

