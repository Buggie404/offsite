import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { AdminRole, isAdminRole } from '../../../shared/models/admin-role.model';
import { ADMIN_DEFAULT_ROUTES } from '../../admin-navigation.config';
import { avatarInitials } from '../../../shared/utils/avatar';

export interface AdminUser {
  _id: string;
  user_id: string;
  email: string;
  profile_name?: string;
  role: AdminRole;
  /** Account created / reset on the Staff page: a new password is required before entering */
  must_change_password?: boolean;
}

export interface AdminLoginResponse {
  token: string;
  user: AdminUser;
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

    if (!token || !isAdminRole(user?.role)) {
      return false;
    }

    if (!this.isTokenValid(token, user.role)) {
      this.logout();
      return false;
    }

    return true;
  }

  private isTokenValid(token: string, role: AdminRole): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number; role?: string };
      if (payload.role !== role) {
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

  /** Name of the signed-in staff member (header, dashboard greeting) */
  getDisplayName(): string {
    const user = this.getUser();
    return user?.profile_name?.trim() || user?.email?.split('@')[0] || 'Admin';
  }

  getInitials(): string {
    return avatarInitials(this.getDisplayName()) || 'A';
  }

  getAdminRole(): AdminRole | null {
    const role = this.getUser()?.role;
    return isAdminRole(role) ? role : null;
  }

  getDefaultRoute(): string {
    const role = this.getAdminRole();
    return role ? ADMIN_DEFAULT_ROUTES[role] : '/admin/403';
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

  async login(email: string, password: string, rememberMe = false): Promise<AdminLoginResponse> {
    const response = await this.requestLogin(email, password);
    this.storeSession(response, rememberMe);
    return response;
  }

  /** Checks the credentials without starting a session (used when a temporary password must be changed first). */
  requestLogin(email: string, password: string): Promise<AdminLoginResponse> {
    return firstValueFrom(
      this.http.post<AdminLoginResponse>('/api/admin/login', { email, password }).pipe(timeout(10_000))
    );
  }

  /** Sets a new password with the token from requestLogin, before the session is stored. */
  changeTemporaryPassword(token: string, oldPassword: string, newPassword: string): Promise<{ message: string }> {
    return firstValueFrom(
      this.http
        .put<{ message: string }>(
          '/api/admin/change-password',
          { oldPassword, newPassword },
          { headers: new HttpHeaders({ Authorization: `Bearer ${token}` }) }
        )
        .pipe(timeout(10_000))
    );
  }

  storeSession(response: AdminLoginResponse, rememberMe = false): void {
    if (isPlatformBrowser(this.platformId)) {
      this.clearStoredSession();

      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(this.tokenKey, response.token);
      storage.setItem(this.userKey, JSON.stringify(response.user));
      localStorage.setItem(this.rememberMeKey, rememberMe ? 'true' : 'false');
    }

    this.isAuthenticatedSignal.set(true);
  }

  logout(): void {
    this.isAuthenticatedSignal.set(false);
    this.clearStoredSession();
  }
}
