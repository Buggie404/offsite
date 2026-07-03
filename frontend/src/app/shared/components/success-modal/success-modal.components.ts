//success-modal/success-modal.components.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SuccessModalConfig {
  title: string;
  subtitle: string;
  primaryBtn: string;
  secondaryBtn?: string;
}

@Component({
  selector: 'app-success-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="success-overlay" (click)="onOverlayClick()">
      <div class="success-modal" (click)="$event.stopPropagation()">
        <!-- Icon -->
        <button class="success-close-btn" (click)="onClose.emit()">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 0, 0, 0.4)" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        </button>
        <div class="success-icon-wrapper">
          <div class="success-icon-bg">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="14.25" stroke="#375534" stroke-width="3.5"/>
              <path d="M9 16.5L13.5 21L23 11" stroke="#375534" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>

        <!-- Content -->
        <h2 class="success-title">{{ config.title }}</h2>
        <p class="success-subtitle">{{ config.subtitle }}</p>

        <!-- Buttons -->
        <div class="success-actions">
          <button class="success-primary-btn" (click)="onPrimary.emit()">
            {{ config.primaryBtn }}
          </button>
          <button *ngIf="config.secondaryBtn" class="success-secondary-btn" (click)="onSecondary.emit()">
            {{ config.secondaryBtn }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .success-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .success-modal {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 28px;
      position: relative;
      width: 512px;
      max-width: 90vw;
      background: #FAF0EB;
      box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.1);
      border-radius: 16px;
      gap: 0;
    }

    .success-icon-wrapper {
      margin-bottom: 24px;
    }

    .success-icon-bg {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 64px;
      height: 64px;
      background: #CFE1B9;
      border-radius: 9999px;
    }

    .success-close-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
        opacity: 0.7;
    }
    }

    .success-title {
      font-family: 'DM Sans', sans-serif;
      font-weight: 600;
      font-size: 24px;
      line-height: 29px;
      color: #375534;
      text-align: center;
      margin: 0 0 12px;
    }

    .success-subtitle {
      font-family: 'DM Sans', sans-serif;
      font-weight: 400;
      font-size: 16px;
      line-height: 24px;
      color: #434840;
      text-align: center;
      margin: 0;
      max-width: 320px;
    }

    .success-actions {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      margin-top: 32px;
    }

    .success-primary-btn {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 12px 32px;
      width: 248px;
      height: 48px;
      background: #375534;
      border-radius: 999px;
      border: none;
      font-family: 'DM Sans', sans-serif;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #FAF0EB;
      cursor: pointer;
    }

    .success-secondary-btn {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 12px 32px;
      height: 46px;
      background: transparent;
      border: 1px solid #375534;
      border-radius: 999px;
      font-family: 'DM Sans', sans-serif;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #375534;
      cursor: pointer;
    }
  `]
})
export class SuccessModalComponent {
  @Input() config!: SuccessModalConfig;
  @Output() onPrimary = new EventEmitter<void>();
  @Output() onSecondary = new EventEmitter<void>();
  @Output() onClose = new EventEmitter<void>();

  onOverlayClick(): void {
    this.onPrimary.emit();
  }
}