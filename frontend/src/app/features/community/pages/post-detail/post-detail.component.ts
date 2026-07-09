import { Component, OnInit, inject, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
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
  showShareModal = false;

  // Content của post sau khi tách hashtag (#tag) ra khỏi text thường, để highlight riêng
  postContentParts: { text: string; isTag: boolean }[] = [];

  // Carousel state
  activeMediaIndex = 0;
  playingVideoIndex: number | null = null;

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
        this.postLiked = post.liked ?? false;
        this.postContentParts = this.parseContentTags(post.content);
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.error = 'Failed to load this post. Please try again.';
        this.loading = false;
        this.cdr.detectChanges();
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

  scrollToComments(): void {
    document.getElementById('comments-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  sharePost(): void {
    this.showShareModal = true;
  }

  closeShareModal(): void {
    this.showShareModal = false;
  }

  get shareUrl(): string {
    return window.location.href;
  }

  // ── Content parsing ──

  // Tách nội dung post thành các đoạn: text thường và hashtag (#xxx) để render highlight riêng
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