import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface AdminUser {
  _id: string;
  user_id: string;
  email: string;
  profile_name?: string;
  role: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminAuthService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);

  private readonly tokenKey = 'admin_token';
  private readonly userKey = 'admin_user';

  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.isAuthenticatedSignal.set(!!localStorage.getItem(this.tokenKey));
    }
  }

  getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(this.tokenKey);
  }

  getUser(): AdminUser | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const raw = localStorage.getItem(this.userKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AdminUser;
    } catch {
      return null;
    }
  }

  isAdmin(): boolean {
    return this.getUser()?.role === 'admin' && !!this.getToken();
  }

  async login(email: string, password: string): Promise<{ token: string; user: AdminUser }> {
    const response = await firstValueFrom(
      this.http.post<{ token: string; user: AdminUser }>('/api/admin/login', { email, password })
    );

    this.isAuthenticatedSignal.set(true);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.tokenKey, response.token);
      localStorage.setItem(this.userKey, JSON.stringify(response.user));
    }

    return response;
  }

  logout(): void {
    this.isAuthenticatedSignal.set(false);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.userKey);
    }
  }
}
