import { Component, Input, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Comment } from '../../models/comment.model';
import { CommunityService } from '../../services/community.service';

interface CommentThread extends Comment {
  replies: Comment[];
}

// Tự chủ hoàn toàn: chỉ cần truyền postId, component tự gọi API load/gửi/like comment,
// không phụ thuộc vào state của component cha (post-detail).
@Component({
  selector: 'app-comment-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-section.component.html',
  styleUrls: ['./comment-section.component.scss']
})
export class CommentSectionComponent implements OnInit {

  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);

  @Input() postId!: string;

  commentThreads: CommentThread[] = [];
  commentsLoading = false;

  // Comment composer state
  newCommentText = '';
  // parentId: top-level comment_id gửi kèm khi submit (backend chỉ hỗ trợ 1 cấp lồng)
  // anchorId: id của item (comment gốc hoặc reply) vừa bấm "Reply", dùng để hiện ô nhập đúng vị trí
  replyingTo: { parentId: string; anchorId: string; username: string } | null = null;
  postingComment = false;

  // Track comment ids đã like trong session này (backend không lưu per-user like state cho comment)
  likedCommentIds = new Set<string>();

  ngOnInit(): void {
    this.loadComments();
  }

  loadComments(): void {
    this.commentsLoading = true;
    this.communityService.getComments(this.postId, 1, 100).subscribe({
      next: (res) => {
        this.commentThreads = this.buildThreads(res.data);
        this.commentsLoading = false;
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
    this.newCommentText = '';
  }

  cancelReply(): void {
    this.replyingTo = null;
  }

  // Xóa nội dung đang gõ ở ô comment chính (nút X)
  clearComment(): void {
    this.newCommentText = '';
  }

  submitComment(): void {
    if (!this.postId || !this.newCommentText.trim() || this.postingComment) return;

    this.postingComment = true;
    const parentId = this.replyingTo?.parentId || null;
    const replyToUsername = this.replyingTo?.username || null;

    this.communityService.createComment(
      this.postId,
      this.newCommentText.trim(),
      parentId,
      replyToUsername
    ).subscribe({
      next: () => {
        this.newCommentText = '';
        this.replyingTo = null;
        this.postingComment = false;
        this.loadComments();
      },
      error: () => {
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

  // ── Relative time ──
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