import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideBookmark, LucideEllipsis, LucideFlag, LucideHeart, LucideMessageCircle, LucideShare2, LucideTrash2 } from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { Post, PostProductCard, postProductLink } from '../../models/post.model';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideEllipsis, LucideFlag, LucideBookmark, LucideTrash2, LucideHeart, LucideMessageCircle, LucideShare2],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss']
})
export class PostCardComponent {
  @Input() post!: Post;
  @Input() isOwner = false;

  @Output() like = new EventEmitter<string>();
  @Output() save = new EventEmitter<string>();
  @Output() share = new EventEmitter<string>();
  @Output() openDetail = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();
  @Output() report = new EventEmitter<string>();

  menuOpen = false;

  constructor(private elementRef: ElementRef) {}

  get hasMedia(): boolean {
    return this.post?.media && this.post.media.length > 0;
  }

  get heroMedia(): any {
    if (!this.hasMedia) return null;
    return this.post.media[0];
  }

  get productTags(): PostProductCard[] {
    return (this.post?.products || []).slice(0, 3);
  }

  productLink(product: PostProductCard): string[] {
    return postProductLink(product);
  }

  get initials(): string {
    const name = (this.post?.author?.username || '').replace(/[^a-zA-Z0-9]/g, '');
    return name.slice(0, 2).toUpperCase();
  }

  // Alternate avatar fallback tones (sage / pink) per user, stable across renders.
  get avatarTone(): 'sage' | 'pink' {
    const name = this.post?.author?.username || '';
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return sum % 2 === 0 ? 'sage' : 'pink';
  }

  onCardClick(): void {
    this.openDetail.emit(this.post.post_id);
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  onMenuSave(event: Event): void {
    this.menuOpen = false;
    this.onSave(event);
  }

  onMenuDelete(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.delete.emit(this.post.post_id);
  }

  onMenuReport(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.report.emit(this.post.post_id);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.menuOpen && !this.elementRef.nativeElement.querySelector('.card-menu-wrap')?.contains(event.target)) {
      this.menuOpen = false;
    }
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
}
