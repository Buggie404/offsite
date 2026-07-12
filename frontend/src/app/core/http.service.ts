import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class HttpService {
  private baseURL = environment.apiUrl;

  constructor() {}

  // TOKEN HELPERS

  private getAccessToken(): string | null {
    return localStorage.getItem('token');
  }
  private getRefreshToken(): string | null {
    return localStorage.getItem('refreshToken');
  }

  private setAccessToken(token: string) {
    localStorage.setItem('token', token);
  }

  // HEADERS
  private createHeaders() {
    const token = this.getAccessToken();

    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  // CORE REQUEST HANDLER

  private async request(
    method: string,
    url: string,
    body?: any,
    retry = true
  ): Promise<any> {
    const options: any = {
        method,
        headers: this.createHeaders(),
    };


    if (method !== 'GET' && body) {
        options.body = JSON.stringify(body);
    }

    const res = await fetch(this.baseURL + url, options);

    // Các endpoint auth công khai: 401 ở đây nghĩa là "sai thông tin đăng nhập",
    // không phải "access token hết hạn" → không được đi qua cơ chế refresh token.
    const isPublicAuthEndpoint =
      url.startsWith('/auth/login') ||
      url.startsWith('/auth/register') ||
      url.startsWith('/auth/verify-registration-otp') ||
      url.startsWith('/auth/resend-registration-otp') ||
      url.startsWith('/auth/forgot-password') ||
      url.startsWith('/auth/reset-password') ||
      url.startsWith('/auth/refresh');

    // HANDLE 401 → TRY REFRESH TOKEN
    if (res.status === 401 && retry && !isPublicAuthEndpoint) {
      const refreshed = await this.refreshToken();

      if (refreshed) {
        // retry original request ONCE
        return this.request(method, url, body, false);
      } else {
        // refresh fail → logout state
        this.logout();
        throw new Error('Unauthorized');
      }
    }

    let data;
    try {
        data = await res.json();
    } catch {
        data = {};
    }

    if (!res.ok) {
      throw data; }
    return data;
  }

  // HTTP METHODS

  get(url: string) {
    return this.request('GET', url);
  }
  post(url: string, body: any) {
    return this.request('POST', url, body);
  }

  put(url: string, body: any) {
    return this.request('PUT', url, body);
  }

  delete(url: string) {
    return this.request('DELETE', url);
  }

  // REFRESH TOKEN FLOW

  private async refreshToken(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) return false;
    try {
      const res = await fetch(this.baseURL + '/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      });

      if (!res.ok) return false;

      const data = await res.json();

      if (data?.token) {
        this.setAccessToken(data.token);
        return true;
      }

      return false;
    } catch (err) {
      return false;
    }
  }

  // LOGOUT FALLBACK
  private logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }
}