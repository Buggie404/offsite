import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideCheck, LucideArrowRight, LucideLock, LucideAlertTriangle } from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';

@Component({
  selector: 'app-payment-qr-scan',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideCheck,
    LucideArrowRight,
    LucideLock,
    LucideAlertTriangle
  ],
  templateUrl: './payment-qr-scan.component.html',
  styleUrl: './payment-qr-scan.component.scss'
})
export class PaymentQrScanComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private checkoutService = inject(CheckoutService);

  // Params state
  orderId = signal<string>('');
  transactionId = signal<string>('');
  amount = signal<number>(0);
  dateTime = signal<string>('');
  expiresAt = signal<number>(0);
  sessionId = signal<string>('');

  formattedDateTime = computed(() => {
    const raw = this.dateTime();
    if (!raw) return '';
    try {
      const parts = raw.split(' ');
      if (parts.length < 2) return raw;
      const dateParts = parts[0].split('-');
      const timeParts = parts[1].split(':');
      
      const year = dateParts[0];
      const monthIndex = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);
      
      const hours = timeParts[0];
      const minutes = timeParts[1];
      
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthStr = months[monthIndex];
      
      return `${monthStr} ${day}, ${year} · ${hours}:${minutes}`;
    } catch (e) {
      return raw;
    }
  });

  // Page state
  loading = signal<boolean>(false);
  isExpired = signal<boolean>(false);
  isFailed = signal<boolean>(false);
  errorMessage = signal<string>('');
  successMessage = signal<string>('');
  hasActionBeenClicked = signal<boolean>(false);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    
    const orderId = params['order_id'];
    const txnId = params['transaction_id'];
    const amount = parseFloat(params['amount'] || '0');
    const dateTime = params['date_time'];
    const expiresAt = parseInt(params['expires_at'] || '0', 10);
    const sessionId = params['session_id'] || '';

    if (!orderId || !txnId || !expiresAt) {
      this.errorMessage.set('Invalid or missing payment details. Please check the QR code.');
      return;
    }

    this.orderId.set(orderId);
    this.transactionId.set(txnId);
    this.amount.set(amount);
    this.dateTime.set(dateTime);
    this.expiresAt.set(expiresAt);
    this.sessionId.set(sessionId);

    // Verify initial expiry
    if (Date.now() >= expiresAt) {
      this.isExpired.set(true);
    }

    // Check localStorage first for instant feedback on reload
    const localAction = localStorage.getItem(`payment_scan_action_${orderId}`);
    if (localAction === 'confirm') {
      this.hasActionBeenClicked.set(true);
      this.successMessage.set('Payment confirmed successfully! Please check your desktop screen.');
    } else if (localAction === 'cancel') {
      this.hasActionBeenClicked.set(true);
      this.isFailed.set(true);
      this.successMessage.set('Payment cancelled. You can now close this tab.');
    }

    // Pull status from backend to verify and synchronize (covers cross-device sync too)
    this.syncWithBackend(orderId, sessionId);
  }

  private async syncWithBackend(orderId: string, sessionId: string): Promise<void> {
    try {
      const res = await this.checkoutService.getOrderStatus(orderId, sessionId);
      if (res.payment_status === 'paid') {
        this.hasActionBeenClicked.set(true);
        this.successMessage.set('Payment confirmed successfully! Please check your desktop screen.');
        localStorage.setItem(`payment_scan_action_${orderId}`, 'confirm');
      } else if (res.payment_status === 'failed') {
        this.hasActionBeenClicked.set(true);
        this.isFailed.set(true);
        this.successMessage.set('Payment cancelled. You can now close this tab.');
        localStorage.setItem(`payment_scan_action_${orderId}`, 'cancel');
      }
    } catch (e) {
      console.error('Failed to sync payment status from backend:', e);
    }
  }

  async confirmPayment(): Promise<void> {
    if (Date.now() >= this.expiresAt()) {
      this.isExpired.set(true);
      alert('The QR code has expired. Please scan a refreshed QR code.');
      return;
    }

    try {
      this.hasActionBeenClicked.set(true);
      this.loading.set(true);
      await this.checkoutService.confirmPayment(this.orderId(), this.sessionId());
      this.successMessage.set('Payment confirmed successfully! Please check your desktop screen.');
      localStorage.setItem(`payment_scan_action_${this.orderId()}`, 'confirm');
    } catch (err: any) {
      console.error('Failed to confirm payment:', err);
      this.hasActionBeenClicked.set(false);
      alert(err.error?.error || 'Failed to confirm payment. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  async cancelPayment(): Promise<void> {
    if (!confirm('Are you sure you want to cancel this payment?')) return;

    try {
      this.hasActionBeenClicked.set(true);
      this.loading.set(true);
      await this.checkoutService.failPayment(this.orderId(), this.sessionId());
      this.isFailed.set(true);
      this.successMessage.set('Payment cancelled. You can now close this tab.');
      localStorage.setItem(`payment_scan_action_${this.orderId()}`, 'cancel');
    } catch (err: any) {
      console.error('Failed to cancel payment:', err);
      this.hasActionBeenClicked.set(false);
      alert(err.error?.error || 'Failed to cancel payment. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
