import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideSearch,
  LucideTruck,
  LucideRefreshCw,
  LucideStar,
  LucideWallet,
  LucidePackageCheck,
  LucideX
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { CartService } from '../../services/cart.service';
import { ReviewModalComponent } from '../../components/review-modal/review-modal.component';
import { CompletePaymentModalComponent } from '../../components/complete-payment-modal/complete-payment-modal.component';
import { PaymentModalComponent } from '../../components/payment-modal/payment-modal.component';
import { ChangePaymentModalComponent } from '../../components/change-payment-modal/change-payment-modal.component';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-order-tracking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideSearch,
    LucideTruck,
    LucideRefreshCw,
    LucideStar,
    LucideWallet,
    LucidePackageCheck,
    ReviewModalComponent,
    CompletePaymentModalComponent,
    PaymentModalComponent,
    ChangePaymentModalComponent,
    ConfirmationModalComponent,
    LucideX
  ],
  templateUrl: './order-tracking.component.html',
  styleUrl: './order-tracking.component.scss'
})
export class OrderTrackingComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private checkoutService = inject(CheckoutService);
  private authService = inject(AuthService);
  private authPromptModalService = inject(AuthPromptModalService);
  private cartService = inject(CartService);

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const orderId = params['orderId'];
      if (orderId) {
        this.searchQuery.set(orderId);
        this.onSearch();
      }
    });
  }

  // Confirmation Modal state properties
  isConfirmModalOpen = false;
  confirmModalTitle = '';
  confirmModalMessage = '';
  confirmModalWarning = '';
  confirmModalConfirmText = 'Confirm';
  confirmModalCancelText = 'Cancel';
  confirmModalType: 'danger' | 'success' | 'info' = 'info';
  confirmModalAction: (() => Promise<void> | void) | null = null;

  onConfirmModalConfirm(): void {
    this.isConfirmModalOpen = false;
    if (this.confirmModalAction) {
      this.confirmModalAction();
    }
  }

  onConfirmModalCancel(): void {
    this.isConfirmModalOpen = false;
    this.confirmModalAction = null;
  }

  searchQuery = signal<string>('');
  verificationQuery = signal<string>('');
  verificationType = signal<'email' | 'phone'>('email');

  isLoading = signal<boolean>(false);
  needsVerification = signal<boolean>(false);
  order = signal<any>(null);
  searched = signal<boolean>(false);
  copiedOrderNum = signal<boolean>(false);
  errorMessage = signal<string>('');
  isFormatError = signal<boolean>(false);
  verificationError = signal<string>('');
  searchedQuery = signal<string>('');
  showReviewModal = signal<boolean>(false);

  // Payment Modal State
  showCompletePaymentModal = signal<boolean>(false);
  showPaymentModal = signal<boolean>(false);
  showChangePaymentModal = signal<boolean>(false);

  // Tracking Modal State
  showTrackingModal = signal<boolean>(false);
  activeTrackingCode = signal<string>('');

  clearFormatError(): void {
    this.isFormatError.set(false);
  }

  clearVerificationError(): void {
    this.verificationError.set('');
  }

  async onSearch(): Promise<void> {
    const code = this.searchQuery().trim();
    if (!code) {
      this.isFormatError.set(true);
      this.errorMessage.set('');
      return;
    }

    // Validate format OFS-YYYY-XXXXX
    const orderFormatRegex = /^OFS-\d{4}-\d{5,}$/i;
    if (!orderFormatRegex.test(code)) {
      this.isFormatError.set(true);
      this.errorMessage.set('');
      return;
    }

    this.isFormatError.set(false);
    const upperCode = code.toUpperCase();
    this.searchedQuery.set(upperCode);

    this.isLoading.set(true);
    this.errorMessage.set('');
    this.order.set(null);
    this.searched.set(false);
    this.needsVerification.set(false);

    // Try to recover guest sessionId from localStorage if order matches
    let sessionId: string | null = null;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('last_order_info');
      if (stored) {
        try {
          const info = JSON.parse(stored);
          if (info && info.orderId === upperCode) {
            sessionId = info.sessionId;
          }
        } catch (e) {
          console.error('Failed to parse last_order_info:', e);
        }
      }
    }

    try {
      // First, try standard fetching (logged in or matching guest session)
      const res = await this.checkoutService.getOrderStatus(upperCode, sessionId);
      this.order.set(res);
      this.searched.set(true);
    } catch (err: any) {
      console.error('Initial order fetch failed:', err);
      if (err.status === 403) {
        // Needs guest verification
        this.needsVerification.set(true);
      } else {
        // Not found or other error
        this.order.set(null);
        this.searched.set(true);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  async onVerify(): Promise<void> {
    const code = this.searchQuery().trim().toUpperCase();
    this.searchedQuery.set(code);
    const verifyValue = this.verificationQuery().trim();
    if (!verifyValue) {
      this.verificationError.set(`Please enter your ${this.verificationType() === 'email' ? 'email' : 'phone number'}.`);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
    this.verificationError.set('');
    this.order.set(null);
    this.searched.set(false);

    try {
      const isEmail = this.verificationType() === 'email';
      const res = await this.checkoutService.trackOrder(code, verifyValue, isEmail);
      this.order.set(res);
      this.needsVerification.set(false);
      this.searched.set(true);
    } catch (err: any) {
      console.error('Verification tracking failed:', err);
      // Details did not match this order — keep the verification form open with an inline error
      this.order.set(null);
      this.verificationError.set(
        err.status === 404
          ? 'No order found with this code.'
          : `This ${this.verificationType() === 'email' ? 'email' : 'phone number'} doesn't match our records for this order. Please try again.`
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  cancelOrder(): void {
    console.log('OrderTrackingComponent.cancelOrder called');
    const ord = this.order();
    if (!ord) return;

    this.confirmModalTitle = 'Cancel Order';
    this.confirmModalMessage = `Are you sure you want to cancel order #${ord.order_id}?`;
    this.confirmModalWarning = 'This action cannot be undone.';
    this.confirmModalConfirmText = 'Cancel Order';
    this.confirmModalCancelText = 'Keep Order';
    this.confirmModalType = 'danger';
    this.confirmModalAction = async () => {
      this.isLoading.set(true);
      this.errorMessage.set('');
      try {
        const res = await this.checkoutService.cancelOrder(ord.order_id, ord.session_id);
        this.router.navigate(['/checkout/canceled'], { state: { order: res.data } });
      } catch (err: any) {
        console.error('Failed to cancel order:', err);
        this.errorMessage.set(err.error?.error || 'Failed to cancel the order. Please try again.');
        if (err.status === 401 || err.status === 403) {
          this.authPromptModalService.open();
        }
      } finally {
        this.isLoading.set(false);
      }
    };
    this.isConfirmModalOpen = true;
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

  confirmReceipt(): void {
    console.log('OrderTrackingComponent.confirmReceipt called');
    const ord = this.order();
    if (!ord) return;
    if (ord.user_id) {
      const currentUser = this.authService.getUser();
      if (!currentUser || ord.user_id !== currentUser.user_id) {
        this.authPromptModalService.open();
        return;
      }
    }

    this.confirmModalTitle = 'Confirm Receipt';
    this.confirmModalMessage = 'Have you received your package? This will mark the order as delivered.';
    this.confirmModalWarning = '';
    this.confirmModalConfirmText = 'Yes, Received';
    this.confirmModalCancelText = 'Not Yet';
    this.confirmModalType = 'success';
    this.confirmModalAction = async () => {
      this.isLoading.set(true);
      try {
        const verificationPayload: { email?: string; mobile?: string } = {};
        const verifyVal = this.verificationQuery().trim();
        if (verifyVal) {
          if (this.verificationType() === 'email') {
            verificationPayload.email = verifyVal;
          } else {
            verificationPayload.mobile = verifyVal;
          }
        }

        const res = await this.checkoutService.receiveOrder(ord.order_id, ord.session_id, verificationPayload);
        this.order.set(res.data);
        if (this.authService.isAuthenticated() || !ord.user_id) {
          this.showReviewModal.set(true);
        } else {
          this.authPromptModalService.open();
        }
      } catch (err: any) {
        console.error('Failed to mark order as received:', err);
        this.errorMessage.set(err.error?.error || 'Failed to update order status. Please try again.');
        if (err.status === 401 || err.status === 403) {
          this.authPromptModalService.open();
        }
      } finally {
        this.isLoading.set(false);
      }
    };
    this.isConfirmModalOpen = true;
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
        this.authPromptModalService.open();
        return;
      }
    }

    if (ord.refund_request?.status === 'pending' || ord.order_status === 'refund') {
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
      return;
    }

    this.router.navigate([`/orders/${ord.order_id || ord._id}/return`], { state: { order: ord } });
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

  getItemCount(): number {
    const ord = this.order();
    if (!ord || !ord.items) return 0;
    return ord.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
  }

  formatOrderDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  getStatusClass(status: string): string {
    const st = (status || '').toLowerCase();
    if (st === 'pending') return 'status--pending';
    if (st === 'processing') return 'status--processing';
    if (st === 'shipping') return 'status--shipping';
    if (st === 'delivered') return 'status--delivered';
    if (st === 'canceled' || st === 'cancelled') return 'status--canceled';
    if (st === 'refund') return 'status--refund';
    if (st === 'pending_refund') return 'status--pending-refund';
    if (st === 'refund_rejected') return 'status--refund-rejected';
    return 'status--pending';
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'PENDING',
      processing: 'PROCESSING',
      shipping: 'SHIPPING',
      delivered: 'DELIVERED',
      canceled: 'CANCELED',
      cancelled: 'CANCELED',
      refund: 'REFUNDED',
      pending_refund: 'PENDING REFUND',
      refund_rejected: 'REFUND REJECTED'
    };
    return labels[status.toLowerCase()] || status.toUpperCase();
  }

  productThumb(item: any): string {
    return item.image?.url || item.image || '';
  }

  navigateToProduct(productId: string): void {
    if (!productId) return;
    this.router.navigate(['/products', productId]);
  }

  trackCarrierOrder(): void {
    const ord = this.order();
    if (!ord) return;
    const trackingCode = ord.shipping?.tracking_number || (ord.order_id ? ord.order_id.replace(/^OFS-/i, 'GHN-') : 'GHN-2026-00044');
    this.activeTrackingCode.set(trackingCode);
    this.showTrackingModal.set(true);
  }

  viewOrderDetails(): void {
    const ord = this.order();
    if (!ord) return;

    if (typeof window !== 'undefined') {
      localStorage.setItem('last_order_info', JSON.stringify({
        orderId: ord.order_id,
        sessionId: ord.session_id || ''
      }));
    }

    const status = (ord.order_status || ord.status || '').toLowerCase();
    if (status === 'pending') {
      this.router.navigate(['/checkout/pending'], { state: { order: ord } });
    } else if (status === 'canceled' || status === 'cancelled') {
      this.router.navigate(['/checkout/canceled'], { state: { order: ord } });
    } else if (status === 'processing') {
      this.router.navigate(['/checkout/processing'], { state: { order: ord } });
    } else if (status === 'shipping') {
      this.router.navigate(['/checkout/shipping'], { state: { order: ord } });
    } else if (status === 'delivered') {
      if (ord.refund_request?.status === 'pending') {
        this.router.navigate(['/checkout/refund'], { state: { order: ord } });
      } else {
        this.router.navigate(['/checkout/delivered'], { state: { order: ord } });
      }
    } else if (status === 'refund' || status === 'pending_refund' || status === 'refund_rejected' || ord.refund_request?.status === 'approved') {
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
    } else {
      this.router.navigate(['/checkout/confirmed'], { state: { order: ord, showModal: false } });
    }
  }

  completePayment(): void {
    const ord = this.order();
    if (!ord) return;

    if (typeof window !== 'undefined') {
      localStorage.setItem('last_order_info', JSON.stringify({
        orderId: ord.order_id,
        sessionId: ord.session_id || ''
      }));
    }
    this.showCompletePaymentModal.set(true);
  }

  closeCompletePaymentModal(): void {
    this.showCompletePaymentModal.set(false);
  }

  async retryPayment(): Promise<void> {
    this.showCompletePaymentModal.set(false);
    const ord = this.order();
    if (!ord) return;

    const method = ord.payment?.method;
    
    // Clear old payment session/actions to ensure a fresh attempt
    localStorage.removeItem(`payment_qr_${ord.order_id}`);
    localStorage.removeItem(`payment_scan_action_${ord.order_id}`);

    try {
      const res = await this.checkoutService.retryPayment(ord.order_id, this.getSessionId(ord));
      const updatedOrder = res.data || ord;
      this.order.set(updatedOrder);

      if (method === 'cod' || method === 'card' || method === 'bank_transfer') {
        this.showPaymentModal.set(true);
      } else if (method === 'qr') {
        this.router.navigate(['/checkout/payment-qr'], { state: { order: updatedOrder } });
      } else {
        this.router.navigate(['/checkout/payment-qr'], { state: { order: updatedOrder } });
      }
    } catch (err: any) {
      console.error('Failed to reset payment status on backend for retry:', err);
      alert('Failed to initiate a new payment session. Please try again.');
      if (err.status === 401 || err.status === 403) {
        this.authPromptModalService.open();
      }
    }
  }

  changePaymentMethod(): void {
    this.showCompletePaymentModal.set(false);
    this.showPaymentModal.set(false);
    this.showChangePaymentModal.set(true);
  }

  closeChangePaymentModal(): void {
    this.showChangePaymentModal.set(false);
  }

  onPaymentMethodChanged(event: { order: any; method: any }): void {
    this.showChangePaymentModal.set(false);
    this.order.set(event.order);

    if (event.method === 'qr') {
      this.router.navigate(['/checkout/payment-qr'], { state: { order: event.order } });
    } else {
      this.showPaymentModal.set(true);
    }
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
}
