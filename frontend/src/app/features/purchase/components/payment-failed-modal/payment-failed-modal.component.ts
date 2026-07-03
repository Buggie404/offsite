import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX, LucideAlertTriangle } from '@lucide/angular';

@Component({
  selector: 'app-payment-failed-modal',
  standalone: true,
  imports: [CommonModule, LucideX, LucideAlertTriangle],
  templateUrl: './payment-failed-modal.component.html',
  styleUrl: './payment-failed-modal.component.scss'
})
export class PaymentFailedModalComponent {
  @Output() close = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
  @Output() changeMethod = new EventEmitter<void>();

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
