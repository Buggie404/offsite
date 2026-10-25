import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, switchMap, startWith } from 'rxjs';

import { Post } from '../../models/post.model';
import { CommunityService } from '../../services/community.service';

import { HeroBannerComponent } from '../../components/hero-banner/hero-banner.component';
import { FeedToolbarComponent } from '../../components/feed-toolbar/feed-toolbar.component';
import { PostCardComponent } from '../../components/post-card/post-card.component';
import { CreatePostModalComponent } from '../../components/create-post-modal/create-post-modal.component';
import { CreateRecipeModalComponent } from '../../components/create-recipe-modal/create-recipe-modal.component';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';
import { ReportPostModalComponent, ReportPayload } from '../../components/report-post-modal/report-post-modal.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { LucideLeaf, LucideCoffee, LucideSparkles, LucideDroplet, LucideDessert, LucideStar, LucideHeart } from '@lucide/angular';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [
    CommonModule,
    HeroBannerComponent,
    FeedToolbarComponent,
    PostCardComponent,
    CreatePostModalComponent,
    CreateRecipeModalComponent,
    BackToTopComponent,
    ShareModalComponent,
    ReportPostModalComponent,
    ConfirmationModalComponent,
    LucideLeaf,
    LucideCoffee,
    LucideSparkles,
    LucideDroplet,
    LucideDessert,
    LucideStar,
    LucideHeart
  ],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.scss']
})
export class FeedComponent implements OnInit, OnDestroy {

  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);
  private toast = inject(ToastService);

  isLoggedIn = this.authService.isAuthenticated;
  isAuthModalOpen = this.authModalService.isOpen;

  posts: Post[] = [];
  page = 1;
  limit = 9;
  loading = false;
  hasMore = true;

  activeCategory: 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | 'FOLLOWING' | '' = '';
  sort: 'created_at' | 'like_count' = 'created_at';

  showCreatePost = false;
  showCreateRecipe = false;
  editingPost: Post | null = null;

  showShareModal = false;
  shareUrl = '';

  pendingDeletePost: Post | null = null;

  reportingPostId: string | null = null;

  get reportingPost(): Post | null {
    return this.reportingPostId ? this.posts.find(p => p.post_id === this.reportingPostId) || null : null;
  }
  reportSubmitting = false;

  private fetch$ = new Subject<void>();
  private isFirstLoginEffect = true;

  isScrollTimelineSupported = true;
  private scrollFrameId: number | null = null;

  constructor() {
    effect(() => {
      const loggedIn = this.isLoggedIn();
      if (this.isFirstLoginEffect) {
        this.isFirstLoginEffect = false;
        return;
      }

      if (loggedIn) {
        this.page = 1;
        setTimeout(() => this.loadFeed(), 0);
      }
    });
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      if (params.get('create') === 'post') {
        setTimeout(() => this.openCreatePost());
        void this.router.navigate([], { relativeTo: this.route, queryParams: { create: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
    });
    if (typeof window !== 'undefined') {
      this.isScrollTimelineSupported =
        typeof CSS !== 'undefined' &&
        CSS.supports &&
        (CSS.supports('animation-timeline: scroll()') || CSS.supports('animation-timeline', 'scroll()'));

      this.updateScrollParallax();
    }

    this.updateFooterVisibility();

    this.fetch$.pipe(
      switchMap(() => {
        const userId = this.activeCategory === 'MY_POST' ? this.authService.getUser()?.user_id : undefined;
        return this.communityService.getFeed(1, 9, this.activeCategory, this.sort, userId, true);
      })
    ).subscribe({
      next: (res) => {
        this.posts = res.data;
        this.page = 1;
        this.hasMore = false;
        this.loading = false;
        this.cdr.markForCheck();
        this.updateFooterVisibility();
        this.updateScrollParallax();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
        this.updateFooterVisibility();
      }
    });

    if (this.communityService.shouldRestoreState && this.communityService.feedState.posts.length > 0) {
      const state = this.communityService.feedState;
      this.posts = state.posts;
      this.page = state.page;
      this.hasMore = state.hasMore;
      this.activeCategory = state.activeCategory;
      this.sort = state.sort;

      this.communityService.shouldRestoreState = false;

      this.cdr.markForCheck();
      this.updateFooterVisibility();
      setTimeout(() => {
        window.scrollTo({ top: state.scrollY, behavior: 'instant' });
        this.updateScrollParallax();
      }, 50);

    } else {
      this.loadFeed();
    }
  }

  openLoginModal(): void {
    this.authModalService.open('login');
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  loadFeed(): void {
    this.loading = true;
    this.cdr.markForCheck();
    this.updateFooterVisibility();
    this.fetch$.next();
  }

  loadMore(): void {
    if (!this.hasMore || this.loading) return;
    this.page++;
    this.loadFeed();
  }

  trackByPost(_index: number, post: Post): string {
    return post.post_id;
  }

  onCategoryChange(category: 'MATCHA' | 'COFFEE' | 'RECIPE' | 'MY_POST' | 'FOLLOWING' | ''): void {
    if (this.loading) return;
    this.activeCategory = category;
    this.page = 1;
    this.loadFeed();
  }

  onSortChange(sort: 'created_at' | 'like_count'): void {
    if (this.loading) return;
    this.sort = sort;
    this.page = 1;
    this.loadFeed();
  }

  // ── FIX LỖI MẤT TRẠNG THÁI LIKE/SAVE Ở ĐÂY ──
  likePost(postId: string): void {
    if (!this.isLoggedIn()) {
      this.openLoginModal();
      return;
    }

    this.communityService.likePost(postId).subscribe(res => {
      const postIndex = this.posts.findIndex(p => p.post_id === postId);
      if (postIndex > -1) {
        // Chỉ ghi đè lại đúng số like và trạng thái liked, giữ nguyên saved
        this.posts[postIndex].like_count = res.like_count;
        this.posts[postIndex].liked = res.liked;
        this.cdr.markForCheck();
      }
    });
  }

  savePost(postId: string): void {
    if (!this.isLoggedIn()) {
      this.openLoginModal();
      return;
    }

    this.communityService.savePost(postId).subscribe(res => {
      const postIndex = this.posts.findIndex(p => p.post_id === postId);
      if (postIndex > -1) {
        // Chỉ ghi đè lại đúng số save và trạng thái saved, giữ nguyên liked
        this.posts[postIndex].save_count = res.save_count;
        this.posts[postIndex].saved = res.saved;
        this.cdr.markForCheck();
      }
    });
  }

  sharePost(postId: string): void {
    const postIndex = this.posts.findIndex(p => p.post_id === postId);
    if (postIndex > -1) {
      this.shareUrl = `${window.location.origin}/community/post/${postId}`;
      this.showShareModal = true;
      this.cdr.markForCheck();

      this.communityService.sharePost(postId).subscribe(res => {
        this.posts[postIndex].share_count = res.share_count;
        this.cdr.markForCheck();
      });
    }
  }

  closeShareModal(): void {
    this.showShareModal = false;
  }

  currentUserId = computed<string | undefined>(() => this.authService.currentUser()?.user_id);

  openReport(postId: string): void {
    if (!this.isLoggedIn()) return this.openLoginModal();
    this.reportingPostId = postId;
  }

  closeReport(): void {
    if (this.reportSubmitting) return;
    this.reportingPostId = null;
  }

  submitReport(payload: ReportPayload): void {
    const postId = this.reportingPostId;
    if (!postId || this.reportSubmitting) return;

    this.reportSubmitting = true;
    this.communityService.reportPost(postId, payload.reason, payload.note).subscribe({
      next: () => {
        this.reportSubmitting = false;
        this.reportingPostId = null;
        this.toast.success('Thanks for letting us know. We will review this post.');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.reportSubmitting = false;
        this.reportingPostId = null;
        this.toast.error(err?.error?.error || 'Failed to submit report. Please try again.');
        this.cdr.markForCheck();
      }
    });
  }

  promptDeletePost(postId: string): void {
    this.pendingDeletePost = this.posts.find(p => p.post_id === postId) || null;
  }

  cancelDeletePost(): void {
    this.pendingDeletePost = null;
  }

  confirmDeletePost(): void {
    const post = this.pendingDeletePost;
    if (!post) return;
    this.pendingDeletePost = null;

    this.communityService.deletePost(post.post_id).subscribe({
      next: () => {
        this.posts = this.posts.filter(p => p.post_id !== post.post_id);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to delete post:', err);
        alert('Failed to delete this post. Please try again.');
      }
    });
  }

  goToDetail(postId: string): void {
    this.communityService.feedState = {
      posts: this.posts,
      page: this.page,
      hasMore: this.hasMore,
      activeCategory: this.activeCategory,
      sort: this.sort,
      scrollY: window.scrollY
    };
    this.communityService.shouldRestoreState = true;

    this.router.navigate(['/community/post', postId]);
  }

  openCreatePost(): void {
    if (!this.isLoggedIn()) return this.openLoginModal();
    this.editingPost = null;
    this.showCreatePost = true;
  }

  closeCreatePost(): void {
    this.showCreatePost = false;
    this.editingPost = null;
  }

  openEdit(post: Post): void {
    if (!this.isLoggedIn()) return this.openLoginModal();
    this.editingPost = post;
    this.showCreatePost = true;
  }

  onPostEdited(postId: string): void {
    this.communityService.getPostById(postId).subscribe(updated => {
      this.posts = this.posts.map(p => (p.post_id === postId ? updated : p));
      this.cdr.markForCheck();
    });
  }

  openCreateRecipe(): void {
    if (!this.isLoggedIn()) return this.openLoginModal();
    this.showCreateRecipe = true;
  }

  closeCreateRecipe(): void {
    this.showCreateRecipe = false;
  }

  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    this.checkScroll();
    this.updateScrollParallax();
  }

  checkScroll(): void {
    if (!this.hasMore || this.loading || !this.isLoggedIn() || this.posts.length === 0) {
      return;
    }

    const threshold = 400; // Load more when within 400px from the bottom
    const height = document.documentElement.scrollHeight;
    const position = window.scrollY + window.innerHeight;

    if (position >= height - threshold) {
      this.loadMore();
    }
  }

  updateScrollParallax(): void {
    if (this.isScrollTimelineSupported || typeof window === 'undefined') return;

    if (this.scrollFrameId) {
      cancelAnimationFrame(this.scrollFrameId);
    }

    this.scrollFrameId = requestAnimationFrame(() => {
      const scrollY = window.scrollY;
      document.documentElement.style.setProperty('--scroll-y', `${scrollY}`);
    });
  }

  updateFooterVisibility(): void {
    if (typeof document !== 'undefined') {
      const hide = this.hasMore || this.loading;
      if (hide) {
        document.body.classList.add('hide-global-footer');
      } else {
        document.body.classList.remove('hide-global-footer');
      }
    }
  }

  ngOnDestroy(): void {
    if (this.scrollFrameId) {
      cancelAnimationFrame(this.scrollFrameId);
    }
    if (typeof document !== 'undefined') {
      document.body.classList.remove('hide-global-footer');
    }
  }
}
