import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-create-recipe-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './create-recipe-modal.component.html',
  styleUrls: ['./create-recipe-modal.component.scss']
})
export class CreateRecipeModalComponent {
  @Output() close = new EventEmitter<void>();

  onClose() {
    this.close.emit();
  }
}