import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AuthModalService {
  private isOpenSignal = signal<boolean>(false);
  private modeSignal = signal<'login' | 'signup'>('login');

  readonly isOpen = this.isOpenSignal.asReadonly();
  readonly mode = this.modeSignal.asReadonly();

  open(mode: 'login' | 'signup' = 'login'): void {
    this.modeSignal.set(mode);
    this.isOpenSignal.set(true);
  }

  close(): void {
    this.isOpenSignal.set(false);
  }

  setMode(mode: 'login' | 'signup'): void {
    this.modeSignal.set(mode);
  }
}
