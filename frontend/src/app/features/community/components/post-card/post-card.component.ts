import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Post } from '../../models/post.model';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss']
})
export class PostCardComponent {
  @Input() post!: Post;
  
  @Output() like = new EventEmitter<string>();
  @Output() save = new EventEmitter<string>();
  @Output() share = new EventEmitter<string>();
  @Output() openDetail = new EventEmitter<string>();

  get hasMedia(): boolean {
    return this.post?.media && this.post.media.length > 0;
  }

  get heroMedia(): any {
    if (!this.hasMedia) return null;
    return this.post.media[0];
  }

  get cardColor(): string {
    return this.post?.base === 'COFFEE' ? '#EFEBE6' : '#EAEFE9';
  }

  onCardClick(): void {
    this.openDetail.emit(this.post.post_id);
  }

  onLike(event: Event): void {
    event.stopPropagation();
    this.like.emit(this.post.post_id);
  }

  onSave(event: Event): void {
    event.stopPropagation();
    this.save.emit(this.post.post_id);
  }

  onShare(event: Event): void {
    event.stopPropagation();
    this.share.emit(this.post.post_id);
  }
  
  onComment(event: Event): void {
    event.stopPropagation();
    this.openDetail.emit(this.post.post_id);
  }

  timeAgo(dateStr: string): string {
    const created = new Date(dateStr).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - created);
    const days = Math.floor(diffMs / 86400000);
    if (days === 0) return 'TODAY';
    if (days === 1) return 'YESTERDAY';
    return `${days}D AGO`;
  }
}


