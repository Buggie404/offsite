import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideBadgeCheck } from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';

@Component({
  selector: 'app-payment-modal',
  standalone: true,
  imports: [CommonModule, LucideBadgeCheck],
  templateUrl: './payment-modal.component.html',
  styleUrl: './payment-modal.component.scss'
})
export class PaymentModalComponent implements OnChanges, OnDestroy {
  private checkoutService = inject(CheckoutService);

  @Input() isOpen = false;
  @Input() orderId: string | null = null;
  @Input() sessionId: string | null = null;
  @Input() paymentMethod = 'cod';
  @Input() mobileNumber = '';

  @Output() confirmed = new EventEmitter<any>();
  @Output() canceled = new EventEmitter<void>();

  status = signal<'confirm-pending' | 'confirmed'>('confirm-pending');
  countdown = signal<number>(5);
  isLoadingConfirm = signal<boolean>(false);
  isLoadingCancel = signal<boolean>(false);
  errorMessage = signal<string | null>(null);

  // OTP features
  otpInputs = signal<string[]>(['', '', '', '', '', '']);
  generatedOtp = signal<string>('');
  incorrectAttempts = signal<number>(0);
  resends = signal<number>(0);
  resendCountdown = signal<number>(60);

  private timerInterval: any = null;
  private resendTimerInterval: any = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.resetModal();
      } else {
        this.stopTimer();
        this.stopResendTimer();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopResendTimer();
  }

  private resetModal(): void {
    this.status.set('confirm-pending');
    this.countdown.set(5);
    this.isLoadingConfirm.set(false);
    this.isLoadingCancel.set(false);
    this.errorMessage.set(null);
    this.stopTimer();
    this.stopResendTimer();

    if (this.paymentMethod === 'cod') {
      this.startTimer();
    } else {
      this.otpInputs.set(['', '', '', '', '', '']);
      this.incorrectAttempts.set(0);
      this.resends.set(0);
      this.generateRandomOtp();
      this.startResendTimer();
    }
  }

  private generateRandomOtp(): void {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.generatedOtp.set(code);
    console.log(`[DEBUG] Generated OTP: ${code}`);
  }

  private startTimer(): void {
    if (this.paymentMethod === 'cod') {
      this.timerInterval = setInterval(() => {
        const current = this.countdown();
        if (current > 1) {
          this.countdown.set(current - 1);
        } else {
          this.countdown.set(0);
          this.stopTimer();
          this.confirmNow(true);
        }
      }, 1000);
    }
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private startResendTimer(): void {
    this.resendCountdown.set(60);
    this.stopResendTimer();
    this.resendTimerInterval = setInterval(() => {
      const current = this.resendCountdown();
      if (current > 1) {
        this.resendCountdown.set(current - 1);
      } else {
        this.resendCountdown.set(0);
        this.stopResendTimer();
      }
    }, 1000);
  }

  private stopResendTimer(): void {
    if (this.resendTimerInterval) {
      clearInterval(this.resendTimerInterval);
      this.resendTimerInterval = null;
    }
  }

  get maskedPhone(): string {
    const phone = this.mobileNumber || '';
    if (!phone) return '+84 xxxx xxxx 88';
    if (phone.length <= 4) return phone;
    const last2 = phone.slice(-2);
    return `+84 xxxx xxxx ${last2}`;
  }

  get formattedResendTimer(): string {
    const seconds = this.resendCountdown();
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  onOtpInput(event: any, index: number): void {
    const input = event.target;
    const value = input.value;
    const currentInputs = [...this.otpInputs()];
    
    const cleanValue = value.replace(/[^0-9]/g, '');
    currentInputs[index] = cleanValue.slice(-1);
    this.otpInputs.set(currentInputs);
    input.value = currentInputs[index];

    if (currentInputs[index] && index < 5) {
      const nextInput = document.getElementById(`otp-input-${index + 1}`) as HTMLInputElement;
      if (nextInput) {
        nextInput.focus();
      }
    }
  }

  onOtpKeyDown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace') {
      const currentInputs = [...this.otpInputs()];
      if (!currentInputs[index] && index > 0) {
        currentInputs[index - 1] = '';
        this.otpInputs.set(currentInputs);
        const prevInput = document.getElementById(`otp-input-${index - 1}`) as HTMLInputElement;
        if (prevInput) {
          prevInput.focus();
        }
      } else {
        currentInputs[index] = '';
        this.otpInputs.set(currentInputs);
      }
      event.preventDefault();
    }
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasteData = event.clipboardData?.getData('text') || '';
    const digits = pasteData.replace(/[^0-9]/g, '').slice(0, 6);
    if (digits.length > 0) {
      const currentInputs = [...this.otpInputs()];
      for (let i = 0; i < 6; i++) {
        currentInputs[i] = digits[i] || '';
      }
      this.otpInputs.set(currentInputs);
      
      const targetIndex = Math.min(digits.length, 5);
      const targetInput = document.getElementById(`otp-input-${targetIndex}`) as HTMLInputElement;
      if (targetInput) {
        targetInput.focus();
      }
    }
  }

  async confirmOtp(): Promise<void> {
    if (this.isLoadingConfirm() || this.isLoadingCancel()) return;
    this.errorMessage.set(null);

    const enteredOtp = this.otpInputs().join('');
    if (enteredOtp.length < 6) {
      this.errorMessage.set('Please enter a 6-digit OTP code.');
      return;
    }

    if (enteredOtp !== this.generatedOtp()) {
      const nextAttempts = this.incorrectAttempts() + 1;
      this.incorrectAttempts.set(nextAttempts);
      
      if (nextAttempts >= 3) {
        this.errorMessage.set('Too many incorrect attempts. Order will be marked as pending.');
        this.isLoadingConfirm.set(true);
        try {
          if (this.orderId) {
            const res = await this.checkoutService.failPayment(this.orderId, this.sessionId);
            setTimeout(() => {
              this.confirmed.emit(res.data);
            }, 1500);
          } else {
            throw new Error('Order ID is missing.');
          }
        } catch (err: any) {
          console.error('Failed to update status to pending:', err);
          this.canceled.emit();
        } finally {
          this.isLoadingConfirm.set(false);
        }
      } else {
        this.errorMessage.set(`Incorrect OTP. You have ${3 - nextAttempts} attempts remaining.`);
        this.otpInputs.set(['', '', '', '', '', '']);
        const firstInput = document.getElementById('otp-input-0') as HTMLInputElement;
        if (firstInput) firstInput.focus();
      }
      return;
    }

    this.isLoadingConfirm.set(true);
    try {
      if (this.orderId) {
        const res = await this.checkoutService.confirmPayment(this.orderId, this.sessionId);
        this.confirmed.emit(res.data);
      } else {
        throw new Error('Order ID is missing.');
      }
    } catch (err: any) {
      console.error('Failed to confirm payment:', err);
      this.errorMessage.set(err.error?.error || 'Failed to confirm payment. Please try again.');
    } finally {
      this.isLoadingConfirm.set(false);
    }
  }

  async resendOtp(): Promise<void> {
    if (this.resendCountdown() > 0 || this.isLoadingConfirm() || this.isLoadingCancel()) return;

    const nextResends = this.resends() + 1;
    if (nextResends > 2) {
      this.errorMessage.set('Resend limit exceeded. Order will be marked as pending.');
      this.isLoadingConfirm.set(true);
      try {
        if (this.orderId) {
          const res = await this.checkoutService.failPayment(this.orderId, this.sessionId);
          setTimeout(() => {
            this.confirmed.emit(res.data);
          }, 1500);
        }
      } catch (err) {
        console.error(err);
        this.canceled.emit();
      } finally {
        this.isLoadingConfirm.set(false);
      }
      return;
    }

    this.resends.set(nextResends);
    this.generateRandomOtp();
    this.startResendTimer();
    this.otpInputs.set(['', '', '', '', '', '']);
    this.errorMessage.set(`New OTP code sent. (${2 - nextResends} resends remaining)`);
    
    setTimeout(() => {
      const firstInput = document.getElementById('otp-input-0') as HTMLInputElement;
      if (firstInput) firstInput.focus();
    }, 100);
  }

  async confirmNow(isAuto = false): Promise<void> {
    if (this.isLoadingConfirm() || this.isLoadingCancel()) return;
    
    this.stopTimer();
    this.isLoadingConfirm.set(true);
    this.errorMessage.set(null);

    try {
      if (this.orderId) {
        const res = await this.checkoutService.confirmOrder(this.orderId, this.sessionId);
        this.confirmed.emit(res.data);
      } else {
        throw new Error('Order ID is missing.');
      }
    } catch (err: any) {
      console.error('Failed to confirm order:', err);
      this.errorMessage.set(err.error?.error || 'Failed to confirm order. Please try again.');
      
      if (isAuto) {
        this.countdown.set(0);
      }
    } finally {
      this.isLoadingConfirm.set(false);
    }
  }

  async cancelOrder(): Promise<void> {
    if (this.isLoadingConfirm() || this.isLoadingCancel()) return;

    this.stopTimer();
    this.stopResendTimer();
    this.errorMessage.set(null);
    this.canceled.emit();
  }

  get strokeDashOffset(): number {
    const circumference = 2 * Math.PI * 36;
    return circumference * (1 - this.countdown() / 5);
  }
}
