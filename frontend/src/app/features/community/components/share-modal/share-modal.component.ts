import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './share-modal.component.html',
  styleUrls: ['./share-modal.component.scss'],
})
export class ShareModalComponent {
  // URL của post cần share — post-detail truyền vào (thường là window.location.href)
  @Input() shareUrl = '';
  @Input() tagline = 'Crafting connections through every shared cup.';

  @Output() close = new EventEmitter<void>();

  copied = false;

  onBackdropClick(): void {
    this.close.emit();
  }

  onRequestClose(): void {
    this.close.emit();
  }

  shareToFacebook(): void {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.shareUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=600');
  }

  shareToX(): void {
    const url = `https://twitter.com/intent/tweet?url=${encodeURIComponent(this.shareUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=600,height=600');
  }

  // WhatsApp cho share trực tiếp qua URL, hoạt động cả mobile (mở app) lẫn desktop (fallback WhatsApp Web)
  shareToWhatsApp(): void {
    const text = `${this.tagline} ${this.shareUrl}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // "More" — mở share sheet gốc của hệ điều hành nếu hỗ trợ, không thì copy link
  shareMore(): void {
    if (navigator.share) {
      navigator.share({ url: this.shareUrl }).catch(() => {});
    } else {
      this.copyToClipboard();
    }
  }

  copyToClipboard(): void {
    navigator.clipboard.writeText(this.shareUrl).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    });
  }
}