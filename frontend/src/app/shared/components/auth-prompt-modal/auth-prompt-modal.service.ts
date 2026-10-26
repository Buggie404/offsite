import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface AuthResume {
  action: 'mark-done' | 'save-brew' | 'save-recipe' | 'save-product';
  slug: string;
  recipeId?: string;
  productId?: number;
}

const RESUME_KEY = 'offsite.authResume';
const RETURN_KEY = 'offsite.authReturn';

@Injectable({
  providedIn: 'root'
})
export class AuthPromptModalService {
  private platformId = inject(PLATFORM_ID);
  private isOpenSignal = signal(false);
  private resume: AuthResume | null = null;
  private keepOnPage = false;

  readonly isOpen = this.isOpenSignal.asReadonly();

  constructor() {
    this.resume = this.readResume();
  }

  open(): void {
    this.isOpenSignal.set(true);
  }

  close(): void {
    this.isOpenSignal.set(false);
  }

  dismiss(): void {
    this.close();
    this.clearResume();
    this.keepOnPage = false;
  }

  prepareLogin(): void {
    this.keepOnPage = true;
    this.close();
  }

  shouldStayOnPage(): boolean {
    return this.keepOnPage || this.resume != null;
  }

  cancelStay(): void {
    this.keepOnPage = false;
  }

  arm(resume: AuthResume): void {
    this.resume = resume;
    this.writeResume(resume);
  }

  peek(): AuthResume | null {
    return this.resume;
  }

  hasResume(): boolean {
    return this.resume != null;
  }

  clearResume(action?: AuthResume['action']): void {
    if (action && this.resume?.action !== action) return;
    this.resume = null;
    if (!isPlatformBrowser(this.platformId)) return;
    sessionStorage.removeItem(RESUME_KEY);
  }

  stashReturnUrl(url: string): void {
    if (!isPlatformBrowser(this.platformId) || !this.isSafeReturn(url)) return;
    if (url.startsWith('/oauth-success') || url.startsWith('/login')) return;
    sessionStorage.setItem(RETURN_KEY, url);
  }

  consumeReturnUrl(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const url = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return url && this.isSafeReturn(url) ? url : null;
  }

  private readResume(): AuthResume | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AuthResume>;
      const action = parsed.action;
      if (
        (action !== 'mark-done' && action !== 'save-brew' && action !== 'save-recipe' && action !== 'save-product')
        || typeof parsed.slug !== 'string'
        || !parsed.slug
      ) {
        return null;
      }
      const recipeId = typeof parsed.recipeId === 'string' && parsed.recipeId ? parsed.recipeId : undefined;
      const productId = typeof parsed.productId === 'number' && Number.isFinite(parsed.productId) ? parsed.productId : undefined;
      if (action === 'save-recipe' && !recipeId) return null;
      if (action === 'save-product' && productId == null) return null;
      return { action, slug: parsed.slug, recipeId, productId };
    } catch {
      return null;
    }
  }

  private writeResume(resume: AuthResume): void {
    if (!isPlatformBrowser(this.platformId)) return;
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume));
  }

  private isSafeReturn(url: string): boolean {
    return url.startsWith('/') && !url.startsWith('//') && !url.includes('://');
  }
}
