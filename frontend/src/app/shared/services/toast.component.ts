import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';
import { LucideCheck, LucideX, LucideInfo } from '@lucide/angular';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule, LucideCheck, LucideX, LucideInfo],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="'toast--' + toast.type" (click)="toastService.remove(toast.id)">
          <div class="toast-icon">
            @if (toast.type === 'success') {
              <svg lucideCheck [size]="18"></svg>
            } @else if (toast.type === 'error') {
              <svg lucideX [size]="18"></svg>
            } @else {
              <svg lucideInfo [size]="18"></svg>
            }
          </div>
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.3s ease-out;
      pointer-events: auto;
      cursor: pointer;
      min-width: 280px;
      max-width: 400px;
    }

    .toast--success {
      background: #375534;
      color: #FAF0EB;
    }

    .toast--error {
      background: #C0392B;
      color: #FFFFFF;
    }

    .toast--info {
      background: #54483E;
      color: #FAF0EB;
    }

    .toast-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .toast-message {
      flex: 1;
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `]
})
export class ToastComponent {
  toastService = inject(ToastService);
}
