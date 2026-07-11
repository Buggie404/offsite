import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { Post } from '../../models/post.model';
import { CommunityService } from '../../services/community.service';
import { CommentSectionComponent } from '../../components/comment-section/comment-section.component';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, CommentSectionComponent, ShareModalComponent],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.scss']
})
export class PostDetailComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('carouselEl') carouselEl?: ElementRef<HTMLDivElement>;

  post: Post | null = null;
  loading = true;
  error: string | null = null;
  postLiked = false;
  postSaved = false;
  showShareModal = false;

  // Content của post sau khi tách hashtag (#tag) ra khỏi text thường, để highlight riêng
  postContentParts: { text: string; isTag: boolean }[] = [];

  // Carousel state
  activeMediaIndex = 0;
  playingVideoIndex: number | null = null;

  // Force re-render các label thời gian tương đối (post + comment) định kỳ,
  // vì Angular chỉ re-evaluate template expression khi có change detection,
  // không tự "tick" theo đồng hồ thật.
  private timeTickHandle?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'Post not found.';
      this.loading = false;
      return;
    }
    this.loadPost(id);
    this.timeTickHandle = setInterval(() => this.cdr.detectChanges(), 30000);
  }

  ngOnDestroy(): void {
    if (this.timeTickHandle) clearInterval(this.timeTickHandle);
  }

  loadPost(id: string): void {
    this.loading = true;
    this.error = null;
    this.communityService.getPostById(id).subscribe({
      next: (post) => {
        this.post = post;
        this.postLiked = post.liked ?? false;
        this.postSaved = post.saved ?? false;
        this.postContentParts = this.parseContentTags(post.content);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (err?.status === 404) {
          void this.router.navigateByUrl('/404', { skipLocationChange: true });
        } else {
          this.error = 'Failed to load this post. Please try again.';
          this.loading = false;
          this.cdr.detectChanges();
        }
      }
    });
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

  // Click left/right arrow buttons để chuyển media (ngoài touch swipe)
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

  savePost(): void {
    if (!this.post) return;

    this.communityService.savePost(this.post.post_id).subscribe({
      next: (res) => {
        if (this.post) {
          this.post.saved = res.saved;
          this.post.save_count = res.save_count;
          this.postSaved = res.saved;
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.error('Failed to save post:', err);
      }
    });
  }

  scrollToComments(): void {
    document.getElementById('comments-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  sharePost(): void {
    this.showShareModal = true;

    // NOTE: this assumes CommunityService gets a `sharePost(postId)` method
    // hitting the new POST /posts/:id/share endpoint (see posts.controller.js).
    // Wire that method up in community.service.ts if it doesn't exist yet.
    if (!this.post) return;
    this.communityService.sharePost(this.post.post_id).subscribe({
      next: (res) => {
        if (this.post) {
          this.post.share_count = res.share_count;
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.error('Failed to record share:', err);
      }
    });
  }

  closeShareModal(): void {
    this.showShareModal = false;
  }

  get shareUrl(): string {
    return window.location.href;
  }

  // Called from (commentCountChange) on <app-comment-section> — keeps the
  // comment count badge in sync the moment a comment/reply is posted,
  // instead of only updating on the next full page load.
  onCommentCountChange(total: number): void {
    if (this.post) {
      this.post.comment_count = total;
      this.cdr.detectChanges();
    }
  }

  parseContentTags(content: string): { text: string; isTag: boolean }[] {
    if (!content) return [];
    return content
      .split(/(#[^\s#]+)/g)
      .filter(part => part.length > 0)
      .map(part => ({ text: part, isTag: part.startsWith('#') }));
  }

  // ── Relative time, dùng cho author row của post ──

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