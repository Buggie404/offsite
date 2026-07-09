import { Component, OnInit, inject, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { Post } from '../../models/post.model';
import { Comment } from '../../models/comment.model';
import { CommunityService } from '../../services/community.service';

interface CommentThread extends Comment {
  replies: Comment[];
}

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.scss']
})
export class PostDetailComponent implements OnInit {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('carouselEl') carouselEl?: ElementRef<HTMLDivElement>;

  post: Post | null = null;
  loading = true;
  error: string | null = null;
  postLiked = false;

  commentThreads: CommentThread[] = [];
  commentsLoading = false;

  // Carousel state
  activeMediaIndex = 0;
  playingVideoIndex: number | null = null;

  // Comment composer state
  newCommentText = '';
  // parentId: top-level comment_id gửi kèm khi submit (backend chỉ hỗ trợ 1 cấp lồng)
  // anchorId: id của item (comment gốc hoặc reply) vừa bấm "Reply", dùng để hiện ô nhập đúng vị trí
  replyingTo: { parentId: string; anchorId: string; username: string } | null = null;
  postingComment = false;

  // Track comment ids already liked in this session (backend doesn't persist per-user like state for comments)
  likedCommentIds = new Set<string>();

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'Post not found.';
      this.loading = false;
      return;
    }
    this.loadPost(id);
  }

  loadPost(id: string): void {
    this.loading = true;
    this.error = null;
    this.communityService.getPostById(id).subscribe({
      next: (post) => {
        this.post = post;
        this.loading = false;
        this.cdr.detectChanges();
        this.loadComments(post.post_id);
      },
      error: () => {
        this.error = 'Failed to load this post. Please try again.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadComments(postId: string): void {
    this.commentsLoading = true;
    this.communityService.getComments(postId, 1, 100).subscribe({
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

  // ── Media carousel ──

  get mediaList() {
    return this.post?.media || [];
  }

  setActiveMedia(index: number): void {
    this.activeMediaIndex = index;
  }

  onCarouselScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== this.activeMediaIndex) {
      this.activeMediaIndex = index;
      if (this.playingVideoIndex !== null) {
        el.querySelectorAll('video').forEach(v => (v as HTMLVideoElement).pause());
        this.playingVideoIndex = null;
      }
    }
  }

  togglePlayVideo(index: number, event: Event): void {
    event.stopPropagation();
    const container = event.currentTarget as HTMLElement;
    const videoEl = container.querySelector('video') as HTMLVideoElement | null;
    if (!videoEl) return;

    if (this.playingVideoIndex === index) {
      videoEl.pause();
      this.playingVideoIndex = null;
    } else {
      videoEl.muted = false;
      videoEl.play().catch(() => {});
      this.playingVideoIndex = index;
    }
  }

  // Click left/right arrow buttons to navigate media (in addition to touch swipe)
  scrollToMedia(index: number): void {
    const el = this.carouselEl?.nativeElement;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
    this.activeMediaIndex = index;
    this.playingVideoIndex = null;
  }

  // ── Like post ──

  likePost(): void {
    if (!this.post) return;
    this.communityService.likePost(this.post.post_id).subscribe(res => {
      if (this.post) {
        this.post.like_count = res.like_count;
        this.postLiked = res.liked;
        this.cdr.detectChanges();
      }
    });
  }

  scrollToComments(): void {
    document.getElementById('comments-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  sharePost(): void {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'Offsite Community', url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url);
    }
  }

  // ── Comments ──

  startReply(parentId: string, anchorId: string, username: string): void {
    this.replyingTo = { parentId, anchorId, username };
    this.newCommentText = '';
  }

  cancelReply(): void {
    this.replyingTo = null;
  }

  submitComment(): void {
    if (!this.post || !this.newCommentText.trim() || this.postingComment) return;

    this.postingComment = true;
    const parentId = this.replyingTo?.parentId || null;
    const replyToUsername = this.replyingTo?.username || null;

    this.communityService.createComment(
      this.post.post_id,
      this.newCommentText.trim(),
      parentId,
      replyToUsername
    ).subscribe({
      next: () => {
        this.newCommentText = '';
        this.replyingTo = null;
        this.postingComment = false;
        this.loadComments(this.post!.post_id);
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

  // ── Relative time, shared by both post and comments ──

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

  goBack(): void {
    this.router.navigate(['/community']);
  }
}