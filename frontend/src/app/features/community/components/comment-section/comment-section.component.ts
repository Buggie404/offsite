import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Comment } from '../../models/comment.model';

// Render 1 dòng comment hoặc reply (avatar, meta, nội dung, actions, ô reply inline).

@Component({
  selector: 'app-comment-item',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-section.component.html',
  styleUrls: ['./comment-section.component.scss']
})
export class CommentItemComponent {

  @Input() comment!: Comment;
  @Input() isReply = false;
  @Input() isLiked = false;
  @Input() postingComment = false;


  @Input() replyingToAnchorId: string | null = null;
  @Input() replyingToUsername = '';


  @Input() newCommentText = '';
  @Output() newCommentTextChange = new EventEmitter<string>();

  @Output() likeToggle = new EventEmitter<void>();
  @Output() replyStart = new EventEmitter<{ anchorId: string; username: string }>();
  @Output() submitReply = new EventEmitter<void>();
  @Output() cancelReply = new EventEmitter<void>();

  get isReplyBoxOpen(): boolean {
    return this.replyingToAnchorId === this.comment.comment_id;
  }

  onTextChange(value: string): void {
    this.newCommentText = value;
    this.newCommentTextChange.emit(value);
  }

  onLikeClick(): void {
    this.likeToggle.emit();
  }

  onReplyClick(): void {
    this.replyStart.emit({
      anchorId: this.comment.comment_id,
      username: this.comment.author.username
    });
  }

  onSubmitReply(): void {
    this.submitReply.emit();
  }

  onCancelReply(): void {
    this.cancelReply.emit();
  }

  timeAgo(dateStr: string): string {
    const created = new Date(dateStr).getTime();
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
}