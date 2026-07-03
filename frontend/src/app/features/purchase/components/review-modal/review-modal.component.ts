import { Component, Input, Output, EventEmitter, inject, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  LucideX,
  LucideChevronRight,
  LucideArrowLeft,
  LucideStar,
  LucideEye,
  LucideEyeOff,
  LucideCheck
} from '@lucide/angular';
import { CheckoutService } from '../../services/checkout.service';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideX,
    LucideChevronRight,
    LucideArrowLeft,
    LucideStar,
    LucideEye,
    LucideEyeOff,
    LucideCheck
  ],
  templateUrl: './review-modal.component.html',
  styleUrl: './review-modal.component.scss'
})
export class ReviewModalComponent implements OnChanges {
  private checkoutService = inject(CheckoutService);
  private router = inject(Router);

  @Input() order: any = null;
  @Input() isOpen = false;
  @Input() verificationDetails: { email?: string; mobile?: string } = {};
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() orderUpdated = new EventEmitter<any>();

  currentScreen: 'choose-item' | 'write-review' | 'submitted' = 'choose-item';
  selectedItem: any = null;
  rating = 0;
  content = '';
  isAnonymous = false;
  isSubmitting = false;
  errorMessage = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetModal();
    }
  }

  resetModal(): void {
    // If there is only one item in the order, we can select it automatically,
    // but the screenshot shows screen 1 "Which product would you like to review?"
    // so starting at 'choose-item' is safer and matches the workflow exactly.
    this.currentScreen = 'choose-item';
    this.selectedItem = null;
    this.rating = 0;
    this.content = '';
    this.isAnonymous = false;
    this.isSubmitting = false;
    this.errorMessage = '';
  }

  close(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
  }

  selectItem(item: any): void {
    if (item.is_reviewed) return; // cannot review again
    this.selectedItem = item;
    this.rating = 0;
    this.content = '';
    this.isAnonymous = false;
    this.errorMessage = '';
    this.currentScreen = 'write-review';
  }

  goBackToChooseItem(): void {
    this.currentScreen = 'choose-item';
    this.selectedItem = null;
  }

  setRating(stars: number): void {
    this.rating = stars;
  }

  get ratingText(): string {
    const texts = ['', 'POOR', 'FAIR', 'GOOD', 'VERY GOOD', 'EXCELLENT'];
    return texts[this.rating] || 'TAP TO RATE';
  }

  getUnreviewedItems(): any[] {
    if (!this.order || !this.order.items) return [];
    return this.order.items.filter((item: any) => !item.is_reviewed);
  }

  hasUnreviewedItems(): boolean {
    return this.getUnreviewedItems().length > 0;
  }

  async onSubmit(): Promise<void> {
    if (!this.rating) {
      this.errorMessage = 'Please select a rating star.';
      return;
    }
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      const payload = {
        order_id: this.order.order_id,
        product_id: this.selectedItem.product_id,
        variant_id: this.selectedItem.variant_id,
        rating: this.rating,
        content: this.content,
        is_anonymous: this.isAnonymous,
        session_id: this.order.session_id,
        email: this.verificationDetails?.email || this.order?.delivery_info?.email || '',
        mobile: this.verificationDetails?.mobile || this.order?.delivery_info?.mobile || ''
      };

      const res = await this.checkoutService.submitReview(payload);
      
      // Update order locally & emit
      if (this.order && this.order.items) {
        const item = this.order.items.find(
          (i: any) => i.product_id === this.selectedItem.product_id && i.variant_id === this.selectedItem.variant_id
        );
        if (item) {
          item.is_reviewed = true;
          item.review_id = res.data?.review_id;
        }
        this.orderUpdated.emit({ ...this.order });
      }

      this.currentScreen = 'submitted';
    } catch (err: any) {
      console.error('Failed to submit review:', err);
      this.errorMessage = err.error?.error || 'Failed to submit your review. Please try again.';
    } finally {
      this.isSubmitting = false;
    }
  }

  reviewAnother(): void {
    this.currentScreen = 'choose-item';
    this.selectedItem = null;
    this.rating = 0;
    this.content = '';
    this.isAnonymous = false;
  }

  backToShop(): void {
    this.close();
    this.router.navigate(['/']);
  }
}
