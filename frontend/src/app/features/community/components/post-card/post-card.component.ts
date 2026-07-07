import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Post } from '../../models/post.model';
import { CommonModule } from '@angular/common';

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
  @Output() openDetail = new EventEmitter<string>(); // thêm dòng này
  @Output() comment = new EventEmitter<string>();
  @Output() share = new EventEmitter<string>();
  @Output() save = new EventEmitter<string>();

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

  onLike() {
    this.like.emit(this.post.post_id);
  }

  onCardClick() {
    this.openDetail.emit(this.post.post_id); 
  }

  onImageError(event: Event) {
    (event.target as HTMLImageElement).src =
      'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?q=80&w=400&auto=format&fit=crop';
  }

  onComment() {
    this.comment.emit(this.post.post_id);
  }

  onShare() {
    this.share.emit(this.post.post_id);
  }

  onSave() {
    this.save.emit(this.post.post_id);
  }
}