import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideBanknote,
  LucideQrCode,
  LucideUpload,
  LucideInfo,
  LucideChevronDown,
  LucidePackage
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../../../core/auth.service';

@Component({
  selector: 'app-order-return',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideArrowLeft,
    LucideCheck,
    LucideBanknote,
    LucideQrCode,
    LucideUpload,
    LucideInfo,
    LucideChevronDown,
    LucidePackage
  ],
  templateUrl: './order-return.component.html',
  styleUrl: './order-return.component.scss'
})
export class OrderReturnComponent implements OnInit {
  public router = inject(Router);
  private route = inject(ActivatedRoute);
  private checkoutService = inject(CheckoutService);
  private authService = inject(AuthService);

  orderId = signal<string | null>(null);
  order = signal<any>(null);
  loading = signal<boolean>(true);

  // Form Fields
  reason = signal<string>('');
  otherReasonText = signal<string>('');
  otherReasonWordCount = signal<number>(0);
  description = signal<string>('');
  evidenceFiles = signal<Array<{ name: string; size: string; url: string }>>([]);

  // Touched validation states
  reasonTouched = signal<boolean>(false);
  otherReasonTouched = signal<boolean>(false);
  evidenceTouched = signal<boolean>(false);
  itemsTouched = signal<boolean>(false);
  
  // Selection states for items
  selectedItems = signal<Record<string, boolean>>({});

  reasonsList = [
    'Damaged item',
    'Wrong item',
    'Size/color mismatch',
    'Other'
  ];

  ngOnInit() {
    this.route.paramMap.subscribe(async params => {
      const id = params.get('id');
      this.orderId.set(id);
      if (id) {
        await this.loadOrderDetails(id);
      } else {
        this.router.navigate(['/']);
      }
    });
  }

  async loadOrderDetails(id: string) {
    try {
      this.loading.set(true);

      let ord = history.state?.['order'];
      let sessionId: string | null = null;
      const savedInfo = localStorage.getItem('last_order_info');
      if (savedInfo) {
        try {
          const parsed = JSON.parse(savedInfo);
          if (parsed && (parsed.orderId === id || parsed.order_id === id)) {
            sessionId = parsed.sessionId || null;
          }
        } catch (e) {}
      }

      if (!ord || (ord.order_id !== id && ord._id !== id)) {
        ord = await this.checkoutService.getOrderStatus(id, sessionId);
      }
      
      this.order.set(ord);

      // Access control
      if (ord.user_id) {
        const currentUser = this.authService.getUser();
        if (!currentUser || currentUser.user_id !== ord.user_id) {
          alert('Access denied. You do not have permission to request a refund for this order.');
          this.router.navigate(['/order-tracking']);
          return;
        }
      }

      // Check order status
      if (ord.order_status !== 'delivered') {
        alert('Refund/return can only be requested for delivered orders.');
        this.router.navigate(['/order-tracking']);
        return;
      }

      if (ord.refund_request?.status === 'pending') {
        alert('A refund request is already pending review for this order.');
        this.router.navigate(['/checkout/refund'], { state: { order: ord } });
        return;
      }

      if (ord.refund_request?.status === 'approved' || ord.order_status === 'refund') {
        this.router.navigate(['/checkout/refund'], { state: { order: ord } });
        return;
      }

      // Initialize all items as selected by default
      const initialSelection: Record<string, boolean> = {};
      if (ord.items) {
        ord.items.forEach((item: any) => {
          initialSelection[item.variant_id] = true;
        });
      }
      this.selectedItems.set(initialSelection);

    } catch (err) {
      console.error('Failed to load order details for return:', err);
      alert('Failed to load order details. Redirecting to tracking.');
      this.router.navigate(['/order-tracking']);
    } finally {
      this.loading.set(false);
    }
  }

  toggleItemSelection(variantId: string) {
    this.selectedItems.update(selection => ({
      ...selection,
      [variantId]: !selection[variantId]
    }));
  }

  isItemSelected(variantId: string): boolean {
    return !!this.selectedItems()[variantId];
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 10 * 1024 * 1024) {
          alert(`File ${file.name} is too large. Max size is 10MB.`);
          continue;
        }
        
        const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        const fakeUrl = URL.createObjectURL(file);
        
        this.evidenceFiles.update(list => [
          ...list,
          { name: file.name, size: sizeStr, url: fakeUrl }
        ]);
      }
    }
  }

  removeFile(index: number) {
    this.evidenceFiles.update(list => list.filter((_, i) => i !== index));
  }

  checkOtherReasonWords(text: string) {
    if (!text) {
      this.otherReasonWordCount.set(0);
      return;
    }
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    this.otherReasonWordCount.set(words.length);
  }

  get selectedItemsList() {
    const ord = this.order();
    if (!ord || !ord.items) return [];
    return ord.items.filter((item: any) => this.isItemSelected(item.variant_id));
  }

  get subtotal(): number {
    return this.selectedItemsList.reduce((sum: number, item: any) => sum + item.unit_price * item.quantity, 0);
  }

  get discountAmount(): number {
    const ord = this.order();
    if (!ord || !ord.pricing || !ord.pricing.discount_amount || !ord.pricing.subtotal) return 0;
    
    const ratio = this.subtotal / ord.pricing.subtotal;
    return Math.round((ratio * ord.pricing.discount_amount) * 100) / 100;
  }

  get totalRefund(): number {
    return Math.max(0, this.subtotal - this.discountAmount);
  }

  get isFormInvalid(): boolean {
    if (!this.reason()) return true;
    if (this.selectedItemsList.length === 0) return true;

    if (this.reason() === 'Other') {
      if (!this.otherReasonText().trim()) return true;
      if (this.otherReasonWordCount() > 200) return true;
    }

    if (this.evidenceFiles().length === 0) return true;

    if (this.description() && this.description().trim().length < 20) return true;
    return false;
  }

  async submitRefundRequest() {
    this.reasonTouched.set(true);
    this.otherReasonTouched.set(true);
    this.evidenceTouched.set(true);
    this.itemsTouched.set(true);

    if (this.isFormInvalid) return;

    try {
      this.loading.set(true);

      const id = this.orderId();
      if (!id) return;

      let sessionId: string | null = null;
      const savedInfo = localStorage.getItem('last_order_info');
      if (savedInfo) {
        try {
          const parsed = JSON.parse(savedInfo);
          if (parsed && (parsed.orderId === id || parsed.order_id === id)) {
            sessionId = parsed.sessionId || null;
          }
        } catch (e) {}
      }

      const payload = {
        reason: this.reason(),
        other_reason: this.reason() === 'Other' ? this.otherReasonText().trim() : undefined,
        description: this.description()?.trim() || undefined,
        evidence: this.evidenceFiles().map((f) => f.url || f.name),
        refund_item: this.selectedItemsList.map((item: any) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity
        }))
      };

      const res = await this.checkoutService.requestRefund(id, payload, sessionId);
      alert('Refund/return request submitted successfully!');
      
      const ord = res.data;
      this.router.navigate(['/checkout/refund'], { state: { order: ord } });
    } catch (err: any) {
      console.error('Failed to submit refund request:', err);
      alert(err.error?.error || 'Failed to submit request. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  getPaymentLabel(order: any): string {
    if (!order || !order.payment) return '';
    const pm = order.payment.method;
    if (pm === 'cod') return 'Cash on Delivery';
    if (pm === 'bank_transfer') return 'Bank Transfer';
    
    const card = order.payment.card_info;
    if (card) {
      return `${card.brand || 'Card'} ending in ${card.last4 || 'xxxx'}`;
    }
    return 'Original Payment Method';
  }

  getPaymentThumbnail(order: any): string {
    if (!order || !order.payment) return '';
    const pm = order.payment.method;
    if (pm === 'cod') {
      return '';
    }
    const card = order.payment.card_info;
    if (card && card.brand) {
      const brand = card.brand.toLowerCase();
      if (brand === 'visa') return 'assets/images/payment_visa.png';
      if (brand === 'mastercard') return 'assets/images/payment_mastercard.png';
      if (brand === 'napas') return 'assets/images/payment_napas.png';
    }
    return 'assets/images/payment_napas.png';
  }
}
