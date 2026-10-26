import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthModalService {
  private isOpenSignal = signal<boolean>(false);
  private modeSignal = signal<'login' | 'signup' | 'forgot'>('login');
  private pendingReferralCodeSignal = signal<string>('');

  readonly isOpen = this.isOpenSignal.asReadonly();
  readonly mode = this.modeSignal.asReadonly();
  readonly pendingReferralCode = this.pendingReferralCodeSignal.asReadonly();

  private successOpenSignal = signal(false);
  readonly successOpen = this.successOpenSignal.asReadonly();

  setSuccessOpen(open: boolean): void {
    this.successOpenSignal.set(open);
  }

  open(mode: 'login' | 'signup' | 'forgot' = 'login'): void {
    this.modeSignal.set(mode);
    this.isOpenSignal.set(true);
  }

  openSignupWithReferral(referralCode: string): void {
    const normalized = String(referralCode || '').trim().toUpperCase();
    this.pendingReferralCodeSignal.set(normalized);
    this.open('signup');
  }

  consumePendingReferralCode(): string {
    const code = this.pendingReferralCodeSignal();
    this.pendingReferralCodeSignal.set('');
    return code;
  }

  close(): void {
    this.isOpenSignal.set(false);
    this.pendingReferralCodeSignal.set('');
  }

  setMode(mode: 'login' | 'signup' | 'forgot'): void {
    this.modeSignal.set(mode);
  }
}