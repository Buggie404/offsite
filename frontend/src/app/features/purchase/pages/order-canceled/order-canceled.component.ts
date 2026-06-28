import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  LucideCheck,
  LucideX,
  LucideCopy,
  LucideBanknote
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { Product } from '../../../../shared/models/product.model';

@Component({
  selector: 'app-order-canceled',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideCheck,
    LucideX,
    LucideCopy,
    LucideBanknote
  ],
  templateUrl: './order-canceled.component.html',
  styleUrl: './order-canceled.component.scss'
})
export class OrderCanceledComponent implements OnInit {
  private router = inject(Router);
  private checkoutService = inject(CheckoutService);

  order = signal<any>(null);
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
      return `${m1} ${day1}, ${y}`;
    } else {
      return `${m1} ${day1} – ${m2} ${day2}, ${y}`;
    }
  }

  getEstDeliveryDate(createdAtStr: string, method: string): string {
    // Return a single date like "June 12, 2026"
    const orderDate = new Date(createdAtStr || Date.now());
    const isExpress = method === 'express';
    const d1 = new Date(orderDate);
    d1.setDate(d1.getDate() + (isExpress ? 1 : 2));
    return d1.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
}
