import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Comment } from '../../models/comment.model';
import { CommunityService } from '../../services/community.service';

interface CommentThread extends Comment {
  replies: Comment[];
}

@Component({
  selector: 'app-comment-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-section.component.html',
  styleUrls: ['./comment-section.component.scss']
})
export class CommentSectionComponent implements OnInit, OnDestroy {

  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);

  @Input() postId!: string;

  @Output() commentCountChange = new EventEmitter<number>();

  commentThreads: CommentThread[] = [];
  commentsLoading = false;

  mainCommentText = '';
  replyCommentText = '';
  
  replyingTo: { parentId: string; anchorId: string; username: string } | null = null;
  postingComment = false;

  likedCommentIds = new Set<string>();

  private timeTickHandle?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.loadComments();
    this.timeTickHandle = setInterval(() => this.cdr.detectChanges(), 30000);
  }

  ngOnDestroy(): void {
    if (this.timeTickHandle) clearInterval(this.timeTickHandle);
  }

  // Lắng nghe sự kiện click chuột trên toàn màn hình
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Nếu không có ô reply nào đang mở thì bỏ qua
    if (!this.replyingTo) return;

    const target = event.target as HTMLElement;

    // Bỏ qua nếu user vừa click vào chính nút "Reply" (để không bị tắt ngay lúc vừa mở)
    if (target.closest('.comment-reply-btn')) return;

    // Bỏ qua nếu user click vào bên trong khung nhập reply (đang gõ phím, click nút gửi...)
    if (target.closest('.inline-reply-box')) return;

    // Nếu click ra không gian ngoài VÀ khung text đang trống -> Tự động đóng
    if (!this.replyCommentText.trim()) {
      this.cancelReply();
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
    this.replyCommentText = ''; 
  }

  cancelReply(): void {
    this.replyingTo = null;
    this.replyCommentText = '';
  }

  submitComment(isReply: boolean): void {
    const text = isReply ? this.replyCommentText : this.mainCommentText;
    
    if (!this.postId || !text.trim() || this.postingComment) return;

    this.postingComment = true;
    let parentId = null;
    let replyToUsername = null;

    if (isReply && this.replyingTo) {
      parentId = this.replyingTo.parentId;
      replyToUsername = this.replyingTo.username;
    }

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


