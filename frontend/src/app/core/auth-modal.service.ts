import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthModalService {
  private isOpenSignal = signal<boolean>(false);
  private modeSignal = signal<'login' | 'signup' | 'forgot'>('login');

  readonly isOpen = this.isOpenSignal.asReadonly();
  readonly mode = this.modeSignal.asReadonly();

  open(mode: 'login' | 'signup' | 'forgot' = 'login'): void {
    this.modeSignal.set(mode);
    this.isOpenSignal.set(true);
  }

  close(): void {
    this.isOpenSignal.set(false);
  }

  setMode(mode: 'login' | 'signup' | 'forgot'): void {
    this.modeSignal.set(mode);
  }
}