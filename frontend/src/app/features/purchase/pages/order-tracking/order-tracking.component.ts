import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideSearch,
  LucideTruck,
  LucideRefreshCw,
  LucideStar,
  LucidePackageCheck
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { CartService } from '../../services/cart.service';
import { ReviewModalComponent } from '../../components/review-modal/review-modal.component';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

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
    LucidePackageCheck,
    ReviewModalComponent
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
  searchedQuery = signal<string>('');
  showReviewModal = signal<boolean>(false);

  clearFormatError(): void {
    this.isFormatError.set(false);
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
      this.errorMessage.set(`Please enter your ${this.verificationType() === 'email' ? 'email' : 'phone number'}.`);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
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
      // Details did not match or order not found
      this.order.set(null);
      this.searched.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  async cancelOrder(): Promise<void> {
    const ord = this.order();
    if (!ord) return;

    if (!confirm('Are you sure you want to cancel this order?')) return;

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const res = await this.checkoutService.cancelOrder(ord.order_id, ord.session_id);
      this.router.navigate(['/checkout/canceled'], { state: { order: res.data } });
    } catch (err: any) {
      console.error('Failed to cancel order:', err);
      this.errorMessage.set(err.error?.error || 'Failed to cancel the order. Please try again.');
    } finally {
      this.isLoading.set(false);
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

  async confirmReceipt(): Promise<void> {
    const ord = this.order();
    if (!ord) return;
    if (ord.user_id) {
      const currentUser = this.authService.getUser();
      if (!currentUser || ord.user_id !== currentUser.user_id) {
        alert('You are not authorized to mark this order as received. Only the user who placed this order can confirm receipt.');
        this.errorMessage.set('You are not authorized to mark this order as received. Only the user who placed this order can confirm receipt.');
        return;
      }
    }
    if (!confirm('Have you received your package? This will mark the order as delivered.')) return;
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
      } else if (typeof window !== 'undefined') {
        // Fallback: check if we stored user email or mobile in delivery info locally or checkout info
        // But verifyVal should be populated from query in onVerify()
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
    } finally {
      this.isLoading.set(false);
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
    } else if (status === 'refund' || ord.refund_request?.status === 'approved') {
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
    } else {
      this.router.navigate(['/checkout/confirmed'], { state: { order: ord, showModal: false } });
    }
  }
}
