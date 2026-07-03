import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX } from '@lucide/angular';
import { UserAddress } from '../../models/user.model';

@Component({
  selector: 'app-delete-address-modal',
  standalone: true,
  imports: [CommonModule, LucideX],
  templateUrl: './delete-address-modal.component.html',
  styleUrl: './delete-address-modal.component.scss'
})
export class DeleteAddressModalComponent {
  @Input() isOpen = false;
  @Input() address: UserAddress | null = null;
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onCancel(): void {
    this.cancel.emit();
  }

  onConfirm(): void {
    this.confirm.emit();
  }
}
