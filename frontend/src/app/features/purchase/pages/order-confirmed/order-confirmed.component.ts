import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  LucideCheck,
  LucideX,
  LucideCopy,
  LucidePackage,
  LucideTruck,
  LucideMapPin,
  LucideArrowRight,
  LucideBadgeCheck,
  LucideBanknote,
  LucideCircleCheck,
  LucideQrCode,
  LucideLandmark
} from '@lucide/angular';
import { CheckoutService, CheckoutItem } from '../../services/checkout.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { CartService } from '../../services/cart.service';
import { Product } from '../../../../shared/models/product.model';

@Component({
  selector: 'app-order-confirmed',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideCheck,
    LucideX,
    LucideCopy,
    LucidePackage,
    LucideTruck,
    LucideMapPin,
    LucideArrowRight,
    LucideBadgeCheck,
    LucideBanknote,
    LucideCircleCheck,
    LucideQrCode,
    LucideLandmark,
    ConfirmationModalComponent
  ],
  templateUrl: './order-confirmed.component.html',
  styleUrl: './order-confirmed.component.scss'
})
export class OrderConfirmedComponent implements OnInit {
  private router = inject(Router);
  private checkoutService = inject(CheckoutService);
  private cartService = inject(CartService);

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

  order = signal<any>(null);
  showModal = signal<boolean>(true);
  complements = signal<Product[]>([]);
  copiedOrderNum = signal<boolean>(false);
  copiedTracking = signal<boolean>(false);

  async ngOnInit(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    // Retrieve state passed from the router
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras.state || history.state;

    if (state && state.order) {
      this.order.set(state.order);
      // Persist order_id and session_id for reload support (crucial for guest checkouts)
      localStorage.setItem('last_order_info', JSON.stringify({
        orderId: state.order.order_id,
        sessionId: state.order.session_id || ''
      }));
      if (state.showModal !== undefined) {
        this.showModal.set(state.showModal);
      } else {
        this.showModal.set(true);
      }
      this.loadRecommendations();
    } else {
      // Attempt recovery from localStorage
      const stored = localStorage.getItem('last_order_info');
      if (stored) {
        try {
          const info = JSON.parse(stored);
          if (info && info.orderId) {
            const fetchedOrder = await this.checkoutService.getOrderStatus(info.orderId, info.sessionId);
            this.order.set(fetchedOrder);
            this.showModal.set(false);
            this.loadRecommendations();
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

  private async loadRecommendations(): Promise<void> {
    try {
      const currentOrder = this.order();
      if (!currentOrder) return;

      const allProducts = await this.checkoutService.getAllProducts();

      // Convert order items to CheckoutItem[] structure required by buildComplements
      const checkoutItems: CheckoutItem[] = currentOrder.items.map((it: any) => {
        const matchingProduct = allProducts.find(p => p._id === it.product_id);
        const dummyProduct: Product = {
          _id: it.product_id,
          product_id: 0,
          name: it.product_name,
          slug: '',
          category: 'matcha',
          variant_type: 'none',
          images: [it.image],
          variants: [{ sku: it.variant_id, price: it.unit_price, is_default: true, stock: 99 }],
          review_count: 0,
          is_active: true,
          createdAt: '',
          updatedAt: ''
        };

        return {
          product: matchingProduct || dummyProduct,
          variantSku: it.variant_id,
          quantity: it.quantity
        };
      });

      const recs = this.checkoutService.buildComplements(checkoutItems, allProducts);
      this.complements.set(recs.slice(0, 3));
    } catch (err) {
      console.error('Failed to load recommendations:', err);
    }
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
      return `${m1} ${day1} – ${day2}, ${y}`;
    } else {
      return `${m1} ${day1} – ${m2} ${day2}, ${y}`;
    }
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

  private getSessionId(ord: any): string | null {
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

  handleCancelOrder(): void {
    console.log('OrderConfirmedComponent.handleCancelOrder called');
    const currentOrder = this.order();
    if (!currentOrder) return;

    this.confirmModalTitle = 'Cancel Order';
    this.confirmModalMessage = `Are you sure you want to cancel order #${currentOrder.order_id}?`;
    this.confirmModalWarning = 'This action cannot be undone.';
    this.confirmModalConfirmText = 'Cancel Order';
    this.confirmModalCancelText = 'Keep Order';
    this.confirmModalType = 'danger';
    this.confirmModalAction = async () => {
      try {
        const res = await this.checkoutService.cancelOrder(currentOrder.order_id, this.getSessionId(currentOrder));
        const canceledOrder = res?.data || {
          ...currentOrder,
          order_status: 'canceled'
        };
        this.router.navigate(['/checkout/canceled'], { state: { order: canceledOrder } });
      } catch (err: any) {
        console.error('Failed to cancel order:', err);
        alert(err.error?.error || 'Failed to cancel the order. Please try again.');
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

  closeModal(): void {
    this.showModal.set(false);
  }

  productThumb(p: Product): string {
    return p.images?.[0]?.url || '';
  }

  productStartingPrice(p: Product): number {
    return p.variants?.[0]?.price || 0;
  }
}
