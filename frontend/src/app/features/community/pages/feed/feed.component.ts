import { Component, OnInit, inject, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
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
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';

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
    ShareModalComponent
  ],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.scss']
})
export class FeedComponent implements OnInit {

  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private authService = inject(AuthService);
  private authModalService = inject(AuthModalService);

  isLoggedIn = this.authService.isAuthenticated;
  isAuthModalOpen = this.authModalService.isOpen;

  posts: Post[] = [];
  page = 1;
  limit = 9;
  loading = false;
  hasMore = true;

  activeCategory: 'MATCHA' | 'COFFEE' | '' = '';
  sort: 'created_at' | 'like_count' = 'created_at';

  showCreatePost = false;
  showCreateRecipe = false;
  
  showShareModal = false;
  shareUrl = '';

  private fetch$ = new Subject<void>();
  private isFirstLoginEffect = true; 

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
    this.fetch$.pipe(
      startWith(undefined), 
      switchMap(() =>
        this.communityService.getFeed(this.page, this.limit, this.activeCategory, this.sort)
      )
    ).subscribe({
      next: (res) => {
        if (this.page === 1) {
          this.posts = res.data;
        } else {
          this.posts.push(...res.data);
        }
        this.hasMore = res.data.length === this.limit;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
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

      this.cdr.detectChanges();
      setTimeout(() => {
        window.scrollTo({ top: state.scrollY, behavior: 'instant' });
      }, 50);
      
    } else {
      this.loading = true;
      this.fetch$.next();
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
    this.cdr.detectChanges();
    this.fetch$.next();
  }

  loadMore(): void {
    if (!this.hasMore || this.loading) return;
    this.page++;
    this.loadFeed();
  }

  onCategoryChange(category: 'MATCHA' | 'COFFEE' | ''): void {
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
        this.cdr.detectChanges();
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
        this.cdr.detectChanges();
      }
    });
  }

  sharePost(postId: string): void {
    const postIndex = this.posts.findIndex(p => p.post_id === postId);
    if (postIndex > -1) {
      this.shareUrl = `${window.location.origin}/community/post/${postId}`;
      this.showShareModal = true;
      this.cdr.detectChanges();

      this.communityService.sharePost(postId).subscribe(res => {
        this.posts[postIndex].share_count = res.share_count;
        this.cdr.detectChanges();
      });
    }
  }

  closeShareModal(): void {
    this.showShareModal = false;
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
    this.showCreatePost = true;
  }

  closeCreatePost(): void {
    this.showCreatePost = false;
  }

  openCreateRecipe(): void {
    if (!this.isLoggedIn()) return this.openLoginModal();
    this.showCreateRecipe = true;
  }

  closeCreateRecipe(): void {
    this.showCreateRecipe = false;
  }
}
