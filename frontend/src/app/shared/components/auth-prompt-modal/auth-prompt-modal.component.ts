import { Component, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideX } from '@lucide/angular';
import { AuthPromptModalService } from './auth-prompt-modal.service';
import { AuthModalService } from '../../../core/auth-modal.service';

@Component({
  selector: 'app-auth-prompt-modal',
  standalone: true,
  imports: [CommonModule, LucideX],
  templateUrl: './auth-prompt-modal.component.html',
  styleUrl: './auth-prompt-modal.component.scss'
})
export class AuthPromptModalComponent {
  private authPromptService = inject(AuthPromptModalService);
  private authModalService = inject(AuthModalService);

  checkOpen = this.authPromptService.isOpen;

  closeModal(): void {
    this.authPromptService.close();
  }

  openLoginModal(): void {
    this.closeModal();
    this.authModalService.open('login');
  }

  @HostListener('document:keydown.escape')
  onEscapeKeydown(): void {
    if (this.checkOpen()) {
      this.closeModal();
    }
  }
}
