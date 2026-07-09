import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

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
  private readonly rememberMeKey = 'admin_remember_me';

  private isAuthenticatedSignal = signal<boolean>(false);
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.isAuthenticatedSignal.set(this.isAdmin());
    }
  }

  isRememberMeEnabled(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return localStorage.getItem(this.rememberMeKey) === 'true';
  }

  getToken(): string | null {
    const storage = this.getActiveStorage();
    return storage?.getItem(this.tokenKey) ?? null;
  }

  getUser(): AdminUser | null {
    const storage = this.getActiveStorage();
    if (!storage) return null;

    const raw = storage.getItem(this.userKey);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as AdminUser;
    } catch {
      return null;
    }
  }

  isAdmin(): boolean {
    const token = this.getToken();
    const user = this.getUser();

    if (!token || user?.role !== 'admin') {
      return false;
    }

    if (!this.isTokenValid(token)) {
      this.logout();
      return false;
    }

    return true;
  }

  private isTokenValid(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number; role?: string };
      if (payload.role && payload.role !== 'admin') {
        return false;
      }
      if (!payload.exp) {
        return true;
      }
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  private getActiveStorage(): Storage | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    if (localStorage.getItem(this.rememberMeKey) === 'true') {
      return localStorage.getItem(this.tokenKey) ? localStorage : null;
    }

    if (sessionStorage.getItem(this.tokenKey)) {
      return sessionStorage;
    }

    if (localStorage.getItem(this.tokenKey)) {
      return localStorage;
    }

    return null;
  }

  private clearStoredSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    localStorage.removeItem(this.rememberMeKey);
    sessionStorage.removeItem(this.tokenKey);
    sessionStorage.removeItem(this.userKey);
  }

  async login(
    email: string,
    password: string,
    rememberMe = false
  ): Promise<{ token: string; user: AdminUser }> {
    const response = await firstValueFrom(
      this.http
        .post<{ token: string; user: AdminUser }>('/api/admin/login', { email, password })
        .pipe(timeout(10_000))
    );

    if (isPlatformBrowser(this.platformId)) {
      this.clearStoredSession();

      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(this.tokenKey, response.token);
      storage.setItem(this.userKey, JSON.stringify(response.user));
      localStorage.setItem(this.rememberMeKey, rememberMe ? 'true' : 'false');
    }

    this.isAuthenticatedSignal.set(true);
    return response;
  }

  logout(): void {
    this.isAuthenticatedSignal.set(false);
    this.clearStoredSession();
  }
}
