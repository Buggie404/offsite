import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, NavigationStart } from '@angular/router';
import {
  LucideArrowLeft,
  LucideClock,
  LucideRefreshCw,
  LucidePackage,
  LucideTag,
  LucideAlertTriangle
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { CartService } from '../../services/cart.service';

interface QrSession {
  transactionId: string;
  dateTime: string;
  expiresAt: number;
  reloadCount: number;
}

@Component({
  selector: 'app-payment-qr',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideArrowLeft,
    LucideClock,
    LucideRefreshCw,
    LucidePackage,
    LucideTag,
    LucideAlertTriangle
  ],
  templateUrl: './payment-qr.component.html',
  styleUrl: './payment-qr.component.scss'
})
export class PaymentQrComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private checkoutService = inject(CheckoutService);
  private cartService = inject(CartService);

  order = signal<any>(null);
  paymentConfirmed = false;
  private targetUrl = '';
  
  // QR session state
  transactionId = signal<string>('');
  dateTime = signal<string>('');
  expiresAt = signal<number>(0);
  reloadCount = signal<number>(0);

  // Expiration and timer state
  timeLeft = signal<string>('15:00');
  isExpired = signal<boolean>(false);
  isFailed = signal<boolean>(false);
  isGlitching = signal<boolean>(false);
  
  private timerInterval: any = null;
  private pollInterval: any = null;

  // Compute the data to encode in the QR code
  qrData = computed(() => {
    if (!this.transactionId() || !this.order()) return '';
    const orderId = this.order().order_id;
    const txnId = this.transactionId();
    const amount = this.order().pricing?.total ?? 0;
    const dt = this.dateTime();
    const expiresAt = this.expiresAt();
    const sessionId = this.order().session_id || '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/checkout/payment-qr/scan?order_id=${orderId}&transaction_id=${txnId}&amount=${amount.toFixed(2)}&date_time=${encodeURIComponent(dt)}&expires_at=${expiresAt}&session_id=${sessionId}`;
  });

  // Generate QR URL from qrserver.com API
  qrCodeUrl = computed(() => {
    if (!this.qrData()) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(this.qrData())}`;
  });

  ngOnInit(): void {
    if (typeof window === 'undefined') return;

    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        this.targetUrl = event.url;
      }
    });

    // Retrieve state passed from the router
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras.state || history.state;

    if (!state || !state.order) {
      console.warn('Access denied. No order state found. Redirecting to home...');
      this.router.navigate(['/']);
      return;
    }

    this.order.set(state.order);
    this.initQrSession();
    this.startPollingStatus();
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopPollingStatus();

    const targetUrl = this.targetUrl;
    const isStayingInCheckoutPaymentFlow = !targetUrl || targetUrl.includes('/checkout/pending') || targetUrl.includes('/checkout/confirmed') || targetUrl.includes('/checkout/payment-qr/scan');

    if (!this.paymentConfirmed && this.order()) {
      if (!isStayingInCheckoutPaymentFlow) {
        const ord = this.order();
        const dbId = ord._id || ord.order_id;
        
        console.log('ngOnDestroy: User left checkout flow. Discarding unpaid QR order...', dbId);
        this.checkoutService.discardOrder(dbId, ord.session_id).catch(err => {
          console.error('Failed to discard QR order in ngOnDestroy:', err);
        });

        const savedItems = localStorage.getItem('checkout_cart_items');
        if (savedItems) {
          try {
            const items = JSON.parse(savedItems);
            this.cartService.restoreItemsToCart(items);
            localStorage.removeItem('checkout_cart_items');
          } catch (e) {
            console.error('Failed to restore cart items on leaving QR page:', e);
          }
        }
      } else {
        console.log('ngOnDestroy: User redirected within checkout flow. Keeping order pending.');
        localStorage.removeItem('checkout_cart_items');
      }
    }
  }

  cancelPayment(): void {
    if (this.order()) {
      this.stopTimer();
      this.stopPollingStatus();
      this.paymentConfirmed = true;
      
      const ord = this.order();
      
      localStorage.removeItem('checkout_cart_items');
      localStorage.removeItem('checkout_delivery_info');
      localStorage.removeItem('checkout_card_info');
      localStorage.removeItem('checkout_bank_info');
      
      this.router.navigate(['/checkout/pending'], { state: { order: ord } });
    }
  }

  private initQrSession(): void {
    const orderId = this.order().order_id;
    const storageKey = `payment_qr_${orderId}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const session: QrSession = JSON.parse(stored);
        
        // If it's already failed, restore failed state
        if (session.reloadCount >= 2 && Date.now() >= session.expiresAt) {
          this.transactionId.set(session.transactionId);
          this.dateTime.set(session.dateTime);
          this.expiresAt.set(session.expiresAt);
          this.reloadCount.set(session.reloadCount);
          this.isExpired.set(true);
          this.isFailed.set(true);
          this.timeLeft.set('00:00');
          return;
        }

        // If it's expired but not failed yet (or could reload), let's check
        if (Date.now() >= session.expiresAt) {
          this.transactionId.set(session.transactionId);
          this.dateTime.set(session.dateTime);
          this.expiresAt.set(session.expiresAt);
          this.reloadCount.set(session.reloadCount);
          this.isExpired.set(true);
          this.timeLeft.set('00:00');
          
          // Check if it already hit limit
          if (session.reloadCount >= 2) {
            this.isFailed.set(true);
            this.triggerPaymentFailed();
          }
        } else {
          // Stored session is still active! Resume it.
          this.transactionId.set(session.transactionId);
          this.dateTime.set(session.dateTime);
          this.expiresAt.set(session.expiresAt);
          this.reloadCount.set(session.reloadCount);
          this.isExpired.set(false);
          this.isFailed.set(false);
          this.startTimer();
        }
      } catch (e) {
        console.error('Failed to parse stored QR session, creating a new one.', e);
        this.createNewSession();
      }
    } else {
      this.createNewSession();
    }
  }

  private createNewSession(): void {
    const txnId = this.generateTransactionId();
    const dt = this.formatDateTime(new Date());
    const expiry = Date.now() + 15 * 60 * 1000; // 15 mins

    this.transactionId.set(txnId);
    this.dateTime.set(dt);
    this.expiresAt.set(expiry);
    this.reloadCount.set(0);
    this.isExpired.set(false);
    this.isFailed.set(false);

    this.saveSession();
    this.startTimer();
  }

  private saveSession(): void {
    const orderId = this.order().order_id;
    const session: QrSession = {
      transactionId: this.transactionId(),
      dateTime: this.dateTime(),
      expiresAt: this.expiresAt(),
      reloadCount: this.reloadCount()
    };
    localStorage.setItem(`payment_qr_${orderId}`, JSON.stringify(session));
  }

  private startTimer(): void {
    this.stopTimer();
    
    const updateCountdown = () => {
      const now = Date.now();
      const diff = this.expiresAt() - now;

      if (diff <= 0) {
        this.stopTimer();
        this.timeLeft.set('00:00');
        this.isExpired.set(true);
        
        // If we have already reloaded 2 times, then this expiry marks the failure
        if (this.reloadCount() >= 2) {
          this.isFailed.set(true);
          this.triggerPaymentFailed();
        }
        
        this.saveSession();
        return;
      }

      const totalSeconds = Math.floor(diff / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      
      const pad = (n: number) => String(n).padStart(2, '0');
      this.timeLeft.set(`${pad(minutes)}:${pad(seconds)}`);
    };

    updateCountdown();
    this.timerInterval = setInterval(updateCountdown, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  async handleRefresh(): Promise<void> {
    // Nếu trong vòng 15min user refresh QR thì không reload lại timer, chạy animation glitch
    if (!this.isExpired()) {
      this.isGlitching.set(true);
      setTimeout(() => {
        this.isGlitching.set(false);
      }, 600);
      return;
    }

    // Nếu đã hết hạn
    if (this.reloadCount() >= 2) {
      // Reload limit exceeded, payment has failed permanently
      this.isFailed.set(true);
      return;
    }

    // Cho phép reload (tối đa 2 lần reload, tương ứng scan 3 lần)
    const nextReloadCount = this.reloadCount() + 1;
    const txnId = this.generateTransactionId();
    const dt = this.formatDateTime(new Date());
    const expiry = Date.now() + 15 * 60 * 1000;

    this.transactionId.set(txnId);
    this.dateTime.set(dt);
    this.expiresAt.set(expiry);
    this.reloadCount.set(nextReloadCount);
    this.isExpired.set(false);

    this.saveSession();
    this.startTimer();
  }

  private async triggerPaymentFailed(): Promise<void> {
    try {
      const ord = this.order();
      if (ord) {
        const res = await this.checkoutService.failPayment(ord.order_id, ord.session_id);
        console.log('Payment status set to failed in backend.');
        this.stopPollingStatus();
        this.stopTimer();
        this.router.navigate(['/checkout/pending'], { state: { order: res.data, showFailedModal: true } });
      }
    } catch (err) {
      console.error('Failed to report payment failure to backend:', err);
    }
  }

  private generateTransactionId(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    let yyy = '';
    let xxxxx = '';
    for (let i = 0; i < 3; i++) {
      yyy += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    for (let i = 0; i < 5; i++) {
      xxxxx += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    return `TXN-${yyy}-${xxxxx}`;
  }

  private formatDateTime(date: Date): string {
    const pad = (num: number) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
  }

  private startPollingStatus(): void {
    this.stopPollingStatus();

    const checkStatus = async () => {
      const ord = this.order();
      if (!ord) return;

      try {
        const res = await this.checkoutService.getOrderStatus(ord.order_id, ord.session_id);
        if (res.payment_status === 'paid') {
          this.paymentConfirmed = true;
          this.stopPollingStatus();
          this.stopTimer();

          // Clear stored checkout details
          localStorage.removeItem('checkout_delivery_info');
          localStorage.removeItem('checkout_cart_items');

          // Navigate to confirmed screen
          this.router.navigate(['/checkout/confirmed'], { state: { order: res } });
        } else if (res.payment_status === 'failed') {
          this.paymentConfirmed = true; // prevent ngOnDestroy from discarding
          this.stopPollingStatus();
          this.stopTimer();
          
          localStorage.removeItem('checkout_delivery_info');
          localStorage.removeItem('checkout_cart_items');
          
          alert('Payment failed. The order is now pending. You can try paying again from your order details.');
          this.router.navigate(['/checkout/pending'], { state: { order: res, showFailedModal: true } });
        }
      } catch (err) {
        console.error('Failed to poll order status:', err);
      }
    };

    // Poll every 3 seconds
    this.pollInterval = setInterval(checkStatus, 3000);
  }

  private stopPollingStatus(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
