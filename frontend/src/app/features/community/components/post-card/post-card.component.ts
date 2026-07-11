import { Component, EventEmitter, Input, Output, inject, ChangeDetectorRef } from '@angular/core';
import { Post } from '../../models/post.model';
import { CommonModule } from '@angular/common';
import { CommunityService } from '../../services/community.service';
import { ShareModalComponent } from '../share-modal/share-modal.component';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, ShareModalComponent],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss']
})
export class PostCardComponent {

  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);

  @Input() post!: Post;

  @Output() like = new EventEmitter<string>();
  @Output() openDetail = new EventEmitter<string>();
  @Output() comment = new EventEmitter<string>();
  @Output() share = new EventEmitter<string>();
  @Output() save = new EventEmitter<string>();

  // Guard chống double-click spam trong lúc request đang bay
  liking = false;
  saving = false;

  // Share dùng modal (giống post-detail) thay vì copy-link im lặng, nên user
  // thấy rõ hành động đã xảy ra + có lựa chọn nền tảng để share tới.
  showShareModal = false;

  get image(): string {
    if (this.post.media?.length) {
      return this.post.media[0].url;
    }
    return 'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?q=80&w=400&auto=format&fit=crop';
  }

  get isVideo(): boolean {
    return !!this.post.media?.length && this.post.media[0].type === 'video';
  }

  private readonly cardColors = [
    '#CFE1B9',  
    '#E8D5B0', 
    '#EFB5D0', 
  ];

  get cardColor(): string {
    let hash = 0;
    const id = this.post.post_id || '';
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % this.cardColors.length;
    }
    return this.cardColors[Math.abs(hash) % this.cardColors.length];
  }

  get hasMedia(): boolean {
    return !!this.post.media?.length;
  }

  get timeAgo(): string {
    const created = new Date(this.post.created_at).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - created);

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (minutes < 1) return 'JUST NOW';
    if (minutes < 60) return `${minutes}M AGO`;
    if (hours < 24) return `${hours}H AGO`;
    return `${days}D AGO`;
  }

  get preview(): string {
    if (!this.post.content) return '';
    const words = this.post.content.trim().split(/\s+/);
    if (words.length <= 10) return this.post.content;
    return words.slice(0, 10).join(' ') + '...';
  }

  // ── Like — self-contained, không cần cha wire subscribe mới hoạt động ──
  onLike(): void {
    if (this.liking) return;
    this.liking = true;
    this.communityService.likePost(this.post.post_id).subscribe({
      next: (res) => {
        this.post.liked = res.liked;
        this.post.like_count = res.like_count;
        this.liking = false;
        this.like.emit(this.post.post_id);
        this.cdr.detectChanges();
      },
      error: () => {
        this.liking = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Save ──
  onSave(): void {
    if (this.saving) return;
    this.saving = true;
    this.communityService.savePost(this.post.post_id).subscribe({
      next: (res) => {
        this.post.saved = res.saved;
        this.post.save_count = res.save_count;
        this.saving = false;
        this.save.emit(this.post.post_id);
        this.cdr.detectChanges();
      },
      error: () => {
        this.saving = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Share — mở modal ngay trên card (giống post-detail), không cần vào chi tiết ──
  get shareUrl(): string {
    return `${window.location.origin}/community/post/${this.post.post_id}`;
  }

  onShare(): void {
    this.showShareModal = true;

    this.communityService.sharePost(this.post.post_id).subscribe({
      next: (res) => {
        this.post.share_count = res.share_count;
        this.share.emit(this.post.post_id);
        this.cdr.detectChanges();
      },
      error: () => {
        // Modal vẫn mở dù record share lỗi — user vẫn share được, chỉ là
        // con số không tăng; không chặn thao tác của họ vì việc này.
      }
    });
  }

  closeShareModal(): void {
    this.showShareModal = false;
  }

  onComment(): void {
    this.comment.emit(this.post.post_id);
    this.openDetail.emit(this.post.post_id);
  }

  onCardClick(): void {
    this.openDetail.emit(this.post.post_id);
  }

  onImageError(event: Event): void {
    (event.target as HTMLImageElement).src =
      'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?q=80&w=400&auto=format&fit=crop';
  }
}