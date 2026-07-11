import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Comment } from '../../models/comment.model';
import { CommunityService } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';

interface CommentThread extends Comment {
  replies: Comment[];
}

@Component({
  selector: 'app-comment-section',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationModalComponent],
  templateUrl: './comment-section.component.html',
  styleUrls: ['./comment-section.component.scss']
})
export class CommentSectionComponent implements OnInit, OnDestroy {

  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);
  private authService = inject(AuthService);

  @Input() postId!: string;
  @Output() commentCountChange = new EventEmitter<number>();

  commentThreads: CommentThread[] = [];
  commentsLoading = false;

  // 1. Tách riêng 2 biến text cho 2 ô input khác nhau
  mainCommentText = '';
  replyCommentText = '';
  
  replyingTo: { parentId: string; anchorId: string; username: string } | null = null;
  postingComment = false;
  likedCommentIds = new Set<string>();

  // 2. Biến phục vụ chức năng xóa comment
  showCommentOptionsFor: string | null = null;
  commentToDelete: string | null = null;
  isConfirmDeleteModalOpen = false;

  private timeTickHandle?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.loadComments();
    this.timeTickHandle = setInterval(() => this.cdr.detectChanges(), 30000);
  }

  ngOnDestroy(): void {
    if (this.timeTickHandle) clearInterval(this.timeTickHandle);
  }

  // 3. Lắng nghe click toàn màn hình
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    // Đóng dropdown 3 chấm nếu click ra ngoài
    if (!target.closest('.comment-options')) {
      this.showCommentOptionsFor = null;
    }

    // Tự động đóng form Reply nếu click ra ngoài VÀ chưa nhập text
    if (this.replyingTo) {
      if (target.closest('.comment-reply-btn')) return; // Bỏ qua nếu đang bấm nút Reply mở form
      if (target.closest('.inline-reply-box')) return;  // Bỏ qua nếu đang click trong khung input
      
      if (!this.replyCommentText.trim()) {
        this.cancelReply();
      }
    }
  }

  loadComments(): void {
    this.commentsLoading = true;
    this.communityService.getComments(this.postId, 1, 100).subscribe({
      next: (res) => {
        this.commentThreads = this.buildThreads(res.data);
        this.commentsLoading = false;
        this.commentCountChange.emit(res.total);
        this.cdr.detectChanges();
      },
      error: () => {
        this.commentsLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private buildThreads(comments: Comment[]): CommentThread[] {
    const topLevel = comments.filter(c => !c.parent_id);
    const repliesByParent = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const list = repliesByParent.get(c.parent_id) || [];
        list.push(c);
        repliesByParent.set(c.parent_id, list);
      }
    }
    return topLevel.map(c => ({
      ...c,
      replies: repliesByParent.get(c.comment_id) || []
    }));
  }

  startReply(parentId: string, anchorId: string, username: string): void {
    this.replyingTo = { parentId, anchorId, username };
    this.replyCommentText = ''; // Xóa sạch chữ cũ của ô reply khi bấm mở lại
  }

  cancelReply(): void {
    this.replyingTo = null;
    this.replyCommentText = '';
  }

  submitComment(isReply: boolean): void {
    const text = isReply ? this.replyCommentText : this.mainCommentText;
    if (!this.postId || !text.trim() || this.postingComment) return;

    this.postingComment = true;
    const parentId = isReply ? (this.replyingTo?.parentId || null) : null;
    const replyToUsername = isReply ? (this.replyingTo?.username || null) : null;

    this.communityService.createComment(
      this.postId,
      text.trim(),
      parentId,
      replyToUsername
    ).subscribe({
      next: () => {
        if (isReply) {
          this.replyCommentText = '';
          this.replyingTo = null;
        } else {
          this.mainCommentText = '';
        }
        this.postingComment = false;
        this.loadComments();
      },
      error: (err) => {
        console.error('Failed to submit comment:', err);
        this.postingComment = false;
        this.cdr.detectChanges();
      }
    });
  }

  toggleLikeComment(comment: Comment): void {
    const alreadyLiked = this.likedCommentIds.has(comment.comment_id);
    const action = alreadyLiked ? 'unlike' : 'like';

    this.communityService.likeComment(comment.comment_id, action).subscribe(res => {
      comment.like_count = res.like_count;
      if (alreadyLiked) {
        this.likedCommentIds.delete(comment.comment_id);
      } else {
        this.likedCommentIds.add(comment.comment_id);
      }
      this.cdr.detectChanges();
    });
  }

  isCommentLiked(comment: Comment): boolean {
    return this.likedCommentIds.has(comment.comment_id);
  }

  // ── Phân quyền và xóa Comment ──
  get currentUser() {
    return this.authService.getUser();
  }

  isCommentAuthor(commentUserId: string): boolean {
    if (!this.currentUser) return false;
    return this.currentUser.user_id === commentUserId;
  }

  toggleCommentOptions(commentId: string, event: Event): void {
    event.stopPropagation();
    if (this.showCommentOptionsFor === commentId) {
      this.showCommentOptionsFor = null;
    } else {
      this.showCommentOptionsFor = commentId;
    }
  }

  promptDeleteComment(commentId: string): void {
    this.showCommentOptionsFor = null;
    this.commentToDelete = commentId;
    this.isConfirmDeleteModalOpen = true;
  }

  cancelDeleteComment(): void {
    this.isConfirmDeleteModalOpen = false;
    this.commentToDelete = null;
  }

  confirmDeleteComment(): void {
    if (!this.commentToDelete) return;
    this.isConfirmDeleteModalOpen = false;
    
    this.communityService.deleteComment(this.commentToDelete).subscribe({
      next: () => {
        this.commentToDelete = null;
        this.loadComments();
      },
      error: (err) => {
        console.error('Failed to delete comment:', err);
        alert('Failed to delete comment. Please try again.');
        this.commentToDelete = null;
      }
    });
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

