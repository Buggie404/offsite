import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX, LucideWallet } from '@lucide/angular';

@Component({
  selector: 'app-complete-payment-modal',
  standalone: true,
  imports: [CommonModule, LucideX, LucideWallet],
  templateUrl: './complete-payment-modal.component.html',
  styleUrl: './complete-payment-modal.component.scss'
})
export class CompletePaymentModalComponent {
  @Output() close = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>(); // Same Payment Method
  @Output() changeMethod = new EventEmitter<void>(); // Change Payment Method

  onClose(): void {
    this.close.emit();
  }

  onRetry(): void {
    this.retry.emit();
  }

  onChangeMethod(): void {
    this.changeMethod.emit();
  }
}
