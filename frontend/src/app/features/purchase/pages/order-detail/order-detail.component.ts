import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  LucideCheck,
  LucideX,
  LucideCopy,
  LucideBanknote,
  LucideBanknoteX,
  LucideClock,
  LucidePackage,
  LucideTruck,
  LucideMapPin,
  LucideQrCode,
  LucideCog,
  LucideArrowRight,
  LucideRefreshCw,
  LucideLandmark
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { CartService } from '../../services/cart.service';
import { PaymentFailedModalComponent } from '../../components/payment-failed-modal/payment-failed-modal.component';
import { CompletePaymentModalComponent } from '../../components/complete-payment-modal/complete-payment-modal.component';
import { PaymentModalComponent } from '../../components/payment-modal/payment-modal.component';
import { ReviewModalComponent } from '../../components/review-modal/review-modal.component';
import { ChangePaymentModalComponent } from '../../components/change-payment-modal/change-payment-modal.component';
import { PaymentMethod } from '../../services/checkout.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

interface StatusConfig {
  bannerStyle: 'canceled' | 'pending' | 'processing' | 'shipping' | 'delivered' | 'refund';
  bannerLabel: string;
  bannerTitle: string;
  trackingDotClass: 'red-dot' | 'warning-dot' | 'success-dot';
  showStepper: boolean;
  chargeText: string;
  showBuyAgain: boolean;
  showPaymentActions: boolean;
  showProcessingActions?: boolean;
  showShippingActions?: boolean;
  showDeliveredActions?: boolean;
  showRefundActions?: boolean;
}

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideCheck,
    LucideX,
    LucideCopy,
    LucideBanknote,
    LucideBanknoteX,
    LucideClock,
    LucidePackage,
    LucideTruck,
    LucideMapPin,
    LucideQrCode,
    LucideCog,
    LucideArrowRight,
    LucideRefreshCw,
    LucideLandmark,
    PaymentFailedModalComponent,
    CompletePaymentModalComponent,
    PaymentModalComponent,
    ReviewModalComponent,
    ChangePaymentModalComponent
  ],
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.scss'
})
export class OrderDetailComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private checkoutService = inject(CheckoutService);
  private cartService = inject(CartService);
  private authService = inject(AuthService);
  private authPromptModalService = inject(AuthPromptModalService);

  order = signal<any>(null);
  copiedOrderNum = signal<boolean>(false);
  copiedTracking = signal<boolean>(false);

  // Pending-specific states
  showFailedModal = signal<boolean>(false);
  showCompletePaymentModal = signal<boolean>(false);
  showPaymentModal = signal<boolean>(false);
  showChangePaymentModal = signal<boolean>(false);
  timeLeft = signal<string>('24:00:00');
  showReviewModal = signal<boolean>(false);
  showTrackingModal = signal<boolean>(false);
  activeTrackingCode = signal<string>('');
  private timerInterval: any = null;
  private refreshInterval: any = null;

  // Configuration map for statuses
  private readonly configMap: Record<'pending' | 'canceled' | 'processing' | 'shipping' | 'delivered' | 'refund', StatusConfig> = {
    canceled: {
      bannerStyle: 'canceled',
      bannerLabel: 'ORDER COMPLETED',
      bannerTitle: 'Canceled!',
      trackingDotClass: 'red-dot',
      showStepper: false,
      chargeText: 'Refunded', // Will be dynamic based on payment method
      showBuyAgain: true,
      showPaymentActions: false
    },
    pending: {
      bannerStyle: 'pending',
      bannerLabel: 'PENDING PAYMENT',
      bannerTitle: 'Almost There!',
      trackingDotClass: 'warning-dot',
      showStepper: true,
      chargeText: 'Pending Payment',
      showBuyAgain: false,
      showPaymentActions: true
    },
    processing: {
      bannerStyle: 'processing',
      bannerLabel: 'ORDER PROCESSING',
      bannerTitle: 'Being Prepared!',
      trackingDotClass: 'success-dot',
      showStepper: true,
      chargeText: 'Paid', // Will be dynamic based on payment method
      showBuyAgain: false,
      showPaymentActions: false,
      showProcessingActions: true
    },
    shipping: {
      bannerStyle: 'shipping',
      bannerLabel: 'ORDER DELIVERING',
      bannerTitle: 'On Your Way!',
      trackingDotClass: 'success-dot',
      showStepper: true,
      chargeText: 'Paid',
      showBuyAgain: false,
      showPaymentActions: false,
      showShippingActions: true
    },
    delivered: {
      bannerStyle: 'delivered',
      bannerLabel: 'ORDER COMPLETED',
      bannerTitle: 'Delivered!',
      trackingDotClass: 'success-dot',
      showStepper: true,
      chargeText: 'Paid',
      showBuyAgain: false,
      showPaymentActions: false,
      showDeliveredActions: true
    },
    refund: {
      bannerStyle: 'refund',
      bannerLabel: 'REFUND REQUESTED',
      bannerTitle: 'Refund Processed!',
      trackingDotClass: 'red-dot',
      showStepper: false,
      chargeText: 'Payment Refunded',
      showBuyAgain: false,
      showPaymentActions: false,
      showRefundActions: true
    }
  };

  // Get configuration dynamically based on the current order status
  config = computed<StatusConfig | null>(() => {
    const ord = this.order();
    if (!ord) return null;

    const status = (ord.order_status || ord.status || '').toLowerCase();
    const refundStatus = ord.refund_request?.status;

    if (status === 'pending_refund' || (status === 'delivered' && refundStatus === 'pending')) {
      return {
        ...this.configMap.refund,
        bannerStyle: 'refund',
        bannerLabel: 'REFUND REQUESTED',
        bannerTitle: 'Under Review',
        trackingDotClass: 'warning-dot',
        showStepper: false,
        chargeText: 'Pending Refund',
        showRefundActions: false
      };
    }

    if (status === 'refund_rejected' || (status === 'delivered' && refundStatus === 'rejected')) {
      return {
        ...this.configMap.refund,
        bannerStyle: 'refund',
        bannerLabel: 'REFUND REQUESTED',
        bannerTitle: 'Refund Declined',
        trackingDotClass: 'red-dot',
        showStepper: false,
        chargeText: 'Refund Rejected',
        showRefundActions: false
      };
    }
    if (status === 'canceled' || status === 'cancelled') {
      const base = this.configMap.canceled;
      return {
        ...base,
        chargeText: ord.payment?.method === 'cod' ? 'Not charged' : 'Refunded'
      };
    }

    if (status === 'processing') {
      const base = this.configMap.processing;
      return {
        ...base,
        chargeText: ord.payment?.method === 'cod' ? 'Pending Payment (COD)' : 'Paid'
      };
    }

    if (status === 'shipping') {
      const base = this.configMap.shipping;
      return {
        ...base,
        chargeText: ord.payment?.method === 'cod' ? 'Pending Payment (COD)' : 'Paid'
      };
    }

    if (status === 'delivered') {
      const base = this.configMap.delivered;
      return {
        ...base,
        chargeText: ord.payment?.method === 'cod' ? 'Paid (COD)' : 'Paid'
      };
    }

    if (status === 'refund') {
      const base = this.configMap.refund;
      return {
        ...base,
        showStepper: false,
        chargeText: ord.payment?.method === 'cod' ? 'Refunded (COD)' : 'Refunded'
      };
    }

    return this.configMap.pending;
  });



  async ngOnInit(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    // Retrieve state passed from the router
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras.state || history.state;

    if (state && state.order) {
      this.order.set(state.order);
      localStorage.setItem('last_order_info', JSON.stringify({
        orderId: state.order.order_id,
        sessionId: state.order.session_id || ''
      }));

      if (state.showFailedModal && (state.order.order_status === 'pending' || state.order.status === 'pending')) {
        this.showFailedModal.set(true);
      }

      if (state.showCompletePayment && (state.order.order_status === 'pending' || state.order.status === 'pending')) {
        this.showCompletePaymentModal.set(true);
      }

      await this.refreshOrderIfNeeded();
      this.checkAndStartTimer();
      this.startPolling();
    } else {
      // Attempt recovery from localStorage
      const stored = localStorage.getItem('last_order_info');
      if (stored) {
        try {
          const info = JSON.parse(stored);
          if (info && info.orderId) {
            const fetchedOrder = await this.checkoutService.getOrderStatus(info.orderId, info.sessionId);
            this.order.set(fetchedOrder);

            const isPending = fetchedOrder.order_status === 'pending' || fetchedOrder.status === 'pending';
            if (isPending && fetchedOrder.payment_status === 'failed') {
              this.showFailedModal.set(true);
            }

            await this.refreshOrderIfNeeded();
            this.checkAndStartTimer();
            this.startPolling();
            return;
          }
        } catch (e) {
          console.error('Failed to recover order from localStorage:', e);
        }
      }

      console.warn('Access denied. No order state or cached order found. Redirecting to home...');
      this.router.navigate(['/']);
    }
  }

  ngOnDestroy(): void {
    this.stopCountdown();
    this.stopPolling();
  }

  private async refreshOrderIfNeeded(): Promise<void> {
    const ord = this.order();
    if (!ord?.order_id) return;

    try {
      const fresh = await this.checkoutService.getOrderStatus(ord.order_id, this.getSessionId(ord));
      this.order.set(fresh);
      this.syncUrlWithStatus(fresh);
    } catch (e) {
      console.error('Failed to refresh order status:', e);
    }
  }

  private syncUrlWithStatus(ord: any): void {
    if (!ord) return;
    const status = (ord.order_status || ord.status || '').toLowerCase();
    const currentUrl = this.router.url;

    let targetPath = '/checkout/confirmed';
    if (status === 'pending') {
      targetPath = '/checkout/pending';
    } else if (status === 'canceled' || status === 'cancelled') {
      targetPath = '/checkout/canceled';
    } else if (status === 'processing') {
      targetPath = '/checkout/processing';
    } else if (status === 'shipping') {
      targetPath = '/checkout/shipping';
    } else if (status === 'delivered') {
      if (ord.refund_request?.status === 'pending') {
        targetPath = '/checkout/refund';
      } else {
        targetPath = '/checkout/delivered';
      }
    } else if (status === 'refund' || status === 'pending_refund' || status === 'refund_rejected' || ord.refund_request?.status === 'approved') {
      targetPath = '/checkout/refund';
    }

    if (!currentUrl.includes(targetPath)) {
      this.router.navigate([targetPath], { replaceUrl: true, state: { order: ord } });
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.refreshInterval = setInterval(async () => {
      await this.refreshOrderIfNeeded();
    }, 5000);
  }

  private stopPolling(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  getRefundTrackingMessage(): string | null {
    const ord = this.order();
    if (!ord) return null;

    const refund = ord.refund_request;
    const status = (ord.order_status || '').toLowerCase();

    if (status === 'pending_refund' || refund?.status === 'pending') {
      return 'Your refund request has been sent to our admin. Please wait 2–3 days for processing.';
    }

    if (refund?.status === 'approved' || status === 'refund') {
      const processedDate = this.getOrderDateFormatted(refund?.reviewed_at || ord.updated_at || ord.updatedAt);
      const amount = ord.pricing?.total || ord.total || 0;
      return `Your refund has been approved. Refund of $${Number(amount).toFixed(2)} processed on ${processedDate}. Allow 3–5 business days for it to appear on your statement.`;
    }

    if (status === 'refund_rejected' || refund?.status === 'rejected') {
      const reason = refund?.admin_reason || 'No reason provided';
      return `Your request has been rejected because ${reason}. If you have any further concern please contact us.`;
    }

    return null;
  }

  hasRefundTrackingMessage(): boolean {
    return !!this.getRefundTrackingMessage();
  }

  shouldShowTrackingAlert(): boolean {
    const style = this.config()?.bannerStyle;
    if (style === 'refund') {
      return this.hasRefundTrackingMessage();
    }
    return style !== 'processing' && style !== 'shipping' && style !== 'delivered';
  }

  canRequestRefund(): boolean {
    const ord = this.order();
    if (!ord) return false;
    const status = (ord.order_status || '').toLowerCase();
    if (status === 'refund_rejected') return true;
    if (status !== 'delivered') return false;
    const refundStatus = ord.refund_request?.status;
    return !refundStatus || refundStatus === 'rejected';
  }

  private checkAndStartTimer(): void {
    const ord = this.order();
    const status = ord?.order_status || ord?.status;
    if (status === 'pending') {
      this.startCountdown();
    } else {
      this.stopCountdown();
    }
  }

  private startCountdown(): void {
    this.stopCountdown();
    const ord = this.order();
    if (!ord) return;

    const createdAtTime = new Date(ord.createdAt || ord.created_at || Date.now()).getTime();
    const expireTime = createdAtTime + 24 * 60 * 60 * 1000; // 24 hours

    const updateTimer = async () => {
      const now = Date.now();
      const diff = expireTime - now;

      if (diff <= 0) {
        this.stopCountdown();
        this.timeLeft.set('00:00:00');
        // Auto cancel order
        try {
          const res = await this.checkoutService.cancelOrder(ord.order_id, this.getSessionId(ord));
          this.order.set(res.data);
        } catch (e) {
          console.error('Failed to auto-cancel expired pending order:', e);
          this.order.set({ ...ord, order_status: 'canceled' });
        }
        return;
      }

      const totalSecs = Math.floor(diff / 1000);
      const hours = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      const pad = (n: number) => String(n).padStart(2, '0');

      this.timeLeft.set(`${pad(hours)}:${pad(mins)}:${pad(secs)}`);
    };

    updateTimer();
    this.timerInterval = setInterval(updateTimer, 1000);
  }

  private stopCountdown(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // RETRY Payment
  async retryPayment(): Promise<void> {
    console.log('[DEBUG] retryPayment called');
    this.showFailedModal.set(false);
    this.showCompletePaymentModal.set(false);
    const ord = this.order();
    console.log('[DEBUG] ord:', ord);
    if (!ord) return;

    const method = ord.payment?.method;
    console.log('[DEBUG] method:', method);
    
    // Clear old payment session/actions to ensure a fresh attempt
    localStorage.removeItem(`payment_qr_${ord.order_id}`);
    localStorage.removeItem(`payment_scan_action_${ord.order_id}`);

    try {
      // Call backend to reset the order's payment status to pending
      const res = await this.checkoutService.retryPayment(ord.order_id, this.getSessionId(ord));
      // Update order signal with the fresh order status from backend
      const updatedOrder = res.data || ord;
      this.order.set(updatedOrder);

      if (method === 'cod' || method === 'card' || method === 'bank_transfer') {
        console.log('[DEBUG] setting showPaymentModal to true');
        this.showPaymentModal.set(true);
      } else if (method === 'qr') {
        this.router.navigate(['/checkout/payment-qr'], { state: { order: updatedOrder } });
      } else {
        this.router.navigate(['/checkout/payment-qr'], { state: { order: updatedOrder } });
      }
    } catch (err) {
      console.error('Failed to reset payment status on backend for retry:', err);
      alert('Failed to initiate a new payment session. Please try again.');
    }
  }

  // Change payment method -> shows a modal to pick a different payment method
  changePaymentMethod(): void {
    this.showFailedModal.set(false);
    this.showCompletePaymentModal.set(false);
    this.showPaymentModal.set(false);
    this.showChangePaymentModal.set(true);
  }

  closeChangePaymentModal(): void {
    this.showChangePaymentModal.set(false);
  }

  onPaymentMethodChanged(event: { order: any; method: PaymentMethod }): void {
    this.showChangePaymentModal.set(false);
    this.order.set(event.order);

    if (event.method === 'qr') {
      this.router.navigate(['/checkout/payment-qr'], { state: { order: event.order } });
    } else {
      this.showPaymentModal.set(true);
    }
  }

  openCompletePaymentModal(): void {
    this.showCompletePaymentModal.set(true);
  }

  closeCompletePaymentModal(): void {
    this.showCompletePaymentModal.set(false);
  }

  isAnyModalOpen(): boolean {
    return this.showFailedModal() || this.showCompletePaymentModal() || this.showPaymentModal() || this.showReviewModal() || this.showChangePaymentModal() || this.showTrackingModal();
  }

  onPaymentConfirmed(updatedOrder: any): void {
    this.showPaymentModal.set(false);
    this.order.set(updatedOrder);
    this.router.navigate(['/checkout/confirmed'], { replaceUrl: true, state: { order: updatedOrder } });
  }

  onPaymentCanceled(): void {
    this.showPaymentModal.set(false);
  }

  getSessionId(ord: any): string | null {
    if (ord?.session_id) return ord.session_id;
    try {
      const stored = localStorage.getItem('last_order_info');
      if (stored) {
        const info = JSON.parse(stored);
        if (info && info.orderId === ord?.order_id) {
          return info.sessionId || null;
        }
      }
    } catch (e) {}
    return null;
  }

  // Cancel order completely
  async cancelOrder(): Promise<void> {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    const ord = this.order();
    if (!ord) return;

    try {
      const res = await this.checkoutService.cancelOrder(ord.order_id, this.getSessionId(ord));
      this.router.navigate(['/checkout/canceled'], { state: { order: res.data } });
    } catch (err: any) {
      console.error('Failed to cancel order:', err);
      alert(err.error?.error || 'Failed to cancel order. Please try again.');
    }
  }

  async buyAgain(): Promise<void> {
    const ord = this.order();
    if (!ord || !ord.items) return;

    try {
      const allProducts = await this.checkoutService.getAllProducts();
      const checkoutItems = ord.items.map((it: any) => {
        const matchingProduct = allProducts.find(p => p._id === it.product_id);
        if (!matchingProduct) return null;
        return {
          product: matchingProduct,
          variantSku: it.variant_id,
          quantity: it.quantity
        };
      }).filter(Boolean);

      if (checkoutItems.length === 0) {
        alert('Products in this order are no longer available.');
        return;
      }

      this.cartService.checkoutSummaryItems.set(checkoutItems);
      localStorage.setItem('checkout_summary_items', JSON.stringify(checkoutItems));
      
      const deliveryInfo = {
        name: ord.delivery_info?.recipient_name || '',
        mobile: ord.delivery_info?.mobile || '',
        email: ord.delivery_info?.email || '',
        city: ord.delivery_info?.city || '',
        address: ord.delivery_info?.address || '',
        note: ord.delivery_info?.note || ''
      };
      localStorage.setItem('checkout_delivery_info', JSON.stringify(deliveryInfo));

      this.cartService.setCheckoutProcessed(true);
      this.router.navigate(['/checkout']);
    } catch (err) {
      console.error('Failed to buy again:', err);
      alert('Failed to load products for checkout. Please try again.');
    }
  }

  closeModal(): void {
    this.showFailedModal.set(false);
  }

  getEstDeliveryRange(createdAtStr: string, method: string): string {
    const orderDate = new Date(createdAtStr || Date.now());
    const isExpress = method === 'express';

    const d1 = new Date(orderDate);
    d1.setDate(d1.getDate() + (isExpress ? 1 : 2));

    const d2 = new Date(orderDate);
    d2.setDate(d2.getDate() + (isExpress ? 2 : 3));

    const m1 = d1.toLocaleString('en-US', { month: 'long' });
    const day1 = d1.getDate();
    const m2 = d2.toLocaleString('en-US', { month: 'long' });
    const day2 = d2.getDate();
    const y = d2.getFullYear();

    if (m1 === m2) {
      return `${m1} ${day1}–${day2}, ${y}`;
    } else {
      return `${m1} ${day1} – ${m2} ${day2}, ${y}`;
    }
  }

  getEstDispatchDate(createdAtStr: string): string {
    const d = new Date(createdAtStr || Date.now());
    d.setDate(d.getDate() + 1);
    return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  getShippingEstDate(createdAtStr: string): string {
    const d = new Date(createdAtStr || Date.now());
    d.setDate(d.getDate() + 1);
    return d.toLocaleString('en-US', { month: 'long', day: 'numeric' });
  }

  getDeliveryEstDateRange(createdAtStr: string): string {
    const d1 = new Date(createdAtStr || Date.now());
    d1.setDate(d1.getDate() + 2);
    const d2 = new Date(createdAtStr || Date.now());
    d2.setDate(d2.getDate() + 3);

    const m1 = d1.toLocaleString('en-US', { month: 'long' });
    const day1 = d1.getDate();
    const m2 = d2.toLocaleString('en-US', { month: 'long' });
    const day2 = d2.getDate();

    if (m1 === m2) {
      return `${m1} ${day1} - ${day2}`;
    } else {
      return `${m1} ${day1} - ${m2} ${day2}`;
    }
  }

  getOrderDateFormatted(createdAtStr: string): string {
    const orderDate = new Date(createdAtStr || Date.now());
    return orderDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  copyOrderNumber(text: string): void {
    navigator.clipboard.writeText(text);
    this.copiedOrderNum.set(true);
    setTimeout(() => this.copiedOrderNum.set(false), 1500);
  }

  copyTrackingNumber(text: string): void {
    navigator.clipboard.writeText(text);
    this.copiedTracking.set(true);
    setTimeout(() => this.copiedTracking.set(false), 1500);
  }

  get trackingNumber(): string {
    const ord = this.order();
    if (!ord) return '';
    return ord.shipping?.tracking_number || 'GHN-' + ord.order_id.replace('OFS-', '');
  }

  productThumb(it: any): string {
    return it.image?.url || it.image || '';
  }

  getItemCount(): number {
    const ord = this.order();
    if (!ord || !ord.items) return 0;
    return ord.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
  }

  trackOrder(): void {
    const ord = this.order();
    if (!ord) return;
    const trackingCode = ord.shipping?.tracking_number || (ord.order_id ? ord.order_id.replace(/^OFS-/i, 'GHN-') : 'GHN-2026-00044');
    this.activeTrackingCode.set(trackingCode);
    this.showTrackingModal.set(true);
  }

  async confirmReceipt(): Promise<void> {
    const ord = this.order();
    if (!ord) return;
    if (ord.user_id) {
      const currentUser = this.authService.getUser();
      if (!currentUser || ord.user_id !== currentUser.user_id) {
        alert('You are not authorized to mark this order as received. Only the user who placed this order can confirm receipt.');
        return;
      }
    }
    if (!confirm('Have you received your package? This will mark the order as delivered.')) return;
    try {
      const res = await this.checkoutService.receiveOrder(ord.order_id, this.getSessionId(ord));
      this.order.set(res.data);
      this.router.navigate(['/checkout/delivered'], { state: { order: res.data } });
    } catch (err: any) {
      console.error('Failed to mark order as received:', err);
      alert(err.error?.error || 'Failed to update order status. Please try again.');
    }
  }

  openReviewModal(): void {
    const ord = this.order();
    if (this.authService.isAuthenticated() || (ord && !ord.user_id)) {
      this.showReviewModal.set(true);
    } else {
      this.authPromptModalService.open();
    }
  }

  onOrderUpdated(updatedOrder: any): void {
    this.order.set(updatedOrder);
  }

  refundOrder(): void {
    const ord = this.order();
    if (!ord) return;

    if (ord.user_id) {
      const currentUser = this.authService.getUser();
      if (!currentUser || currentUser.user_id !== ord.user_id) {
        alert('Access denied. You do not have permission to request a refund for this order.');
        return;
      }
    }

    this.router.navigate([`/orders/${ord.order_id || ord._id}/return`], { state: { order: ord } });
  }

  isStepCompleted(stepNum: number): boolean {
    const status = (this.order()?.order_status || this.order()?.status || '').toLowerCase();
    const deliveredGroup = ['delivered', 'refund', 'pending_refund', 'refund_rejected'];
    if (stepNum === 1) {
      return status === 'processing' || status === 'shipping' || deliveredGroup.includes(status);
    }
    if (stepNum === 2) {
      return status === 'shipping' || deliveredGroup.includes(status);
    }
    if (stepNum === 3) {
      return deliveredGroup.includes(status) || !!this.order()?.delivered_at;
    }
    return false;
  }

  isStepActive(stepNum: number): boolean {
    const status = (this.order()?.order_status || this.order()?.status || '').toLowerCase();
    if (stepNum === 1) {
      return false;
    }
    if (stepNum === 2) {
      return status === 'processing';
    }
    if (stepNum === 3) {
      return status === 'shipping';
    }
    if (stepNum === 4) {
      return status === 'delivered';
    }
    return false;
  }
}
