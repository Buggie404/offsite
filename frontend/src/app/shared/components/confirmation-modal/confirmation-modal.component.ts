import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX, LucideAlertTriangle, LucideCheck, LucideInfo } from '@lucide/angular';

@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [CommonModule, LucideX, LucideAlertTriangle, LucideCheck, LucideInfo],
  templateUrl: './confirmation-modal.component.html',
  styleUrl: './confirmation-modal.component.scss'
})
export class ConfirmationModalComponent implements OnChanges, OnDestroy {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private previousFocus: HTMLElement | null = null;
  @Input() isOpen = false;
  @Input() title = '';
  @Input() message = '';
  @Input() warningMessage = '';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';
  @Input() type: 'danger' | 'success' | 'info' = 'info';
  @Input() appearance: 'default' | 'admin' = 'default';

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['isOpen']) return;
    if (this.isOpen) {
      this.previousFocus = this.element.nativeElement.ownerDocument.activeElement as HTMLElement;
      queueMicrotask(() => { if (this.isOpen) this.element.nativeElement.querySelector<HTMLButtonElement>('.btn-cancel')?.focus(); });
    } else this.restoreFocus();
  }

  private restoreFocus(): void { this.previousFocus?.focus?.(); this.previousFocus = null; }
  ngOnDestroy(): void { this.restoreFocus(); }
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); this.cancel.emit(); }
    if (event.key !== 'Tab') return;
    const buttons = this.element.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
    const first = buttons[0], last = buttons[buttons.length - 1];
    const active = this.element.nativeElement.ownerDocument.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onConfirm(): void {
    this.confirm.emit();
  }
}
