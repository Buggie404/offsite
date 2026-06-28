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
  LucideCircleCheck
} from '@lucide/angular';
import { CheckoutService, CheckoutItem } from '../../services/checkout.service';
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
    LucideCircleCheck
  ],
  templateUrl: './order-confirmed.component.html',
  styleUrl: './order-confirmed.component.scss'
})
export class OrderConfirmedComponent implements OnInit {
  private router = inject(Router);
  private checkoutService = inject(CheckoutService);

  order = signal<any>(null);
  showModal = signal<boolean>(true);
  complements = signal<Product[]>([]);
  copiedOrderNum = signal<boolean>(false);
  copiedTracking = signal<boolean>(false);

  ngOnInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Retrieve state passed from the router
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras.state || history.state;

    if (!state || !state.order) {
      console.warn('Access denied. No order state found. Redirecting to home...');
      this.router.navigate(['/']);
      return;
    }

    this.order.set(state.order);
    this.loadRecommendations();
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

  async handleCancelOrder(): Promise<void> {
    const currentOrder = this.order();
    if (!currentOrder) return;

    if (confirm('Are you sure you want to cancel this order?')) {
      try {
        await this.checkoutService.cancelOrder(currentOrder.order_id, currentOrder.session_id);
        const canceledOrder = {
          ...currentOrder,
          order_status: 'canceled'
        };
        this.router.navigate(['/checkout/canceled'], { state: { order: canceledOrder } });
      } catch (err: any) {
        console.error('Failed to cancel order:', err);
        alert(err.error?.error || 'Failed to cancel the order. Please try again.');
      }
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
