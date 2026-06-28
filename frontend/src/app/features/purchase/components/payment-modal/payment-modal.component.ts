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

  @Output() confirmed = new EventEmitter<any>();
  @Output() canceled = new EventEmitter<void>();

  status = signal<'confirm-pending' | 'confirmed'>('confirm-pending');
  countdown = signal<number>(5);
  isLoadingConfirm = signal<boolean>(false);
  isLoadingCancel = signal<boolean>(false);
  errorMessage = signal<string | null>(null);

  private timerInterval: any = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.resetModal();
      } else {
        this.stopTimer();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  private resetModal(): void {
    this.status.set('confirm-pending');
    this.countdown.set(5);
    this.isLoadingConfirm.set(false);
    this.isLoadingCancel.set(false);
    this.errorMessage.set(null);
    this.stopTimer();
    this.startTimer();
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
      
      // If auto-confirm fails, allow the user to retry manually
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
    this.isLoadingCancel.set(true);
    this.errorMessage.set(null);

    try {
      if (this.orderId) {
        await this.checkoutService.cancelOrder(this.orderId, this.sessionId);
      }
      this.canceled.emit();
    } catch (err: any) {
      console.error('Failed to cancel order:', err);
      // Close the modal anyway since the user wanted to cancel
      this.canceled.emit();
    } finally {
      this.isLoadingCancel.set(false);
    }
  }

  get strokeDashOffset(): number {
    const circumference = 2 * Math.PI * 36; // radius is 36
    return circumference * (1 - this.countdown() / 5);
  }
}
