import { Component, OnInit, inject, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, switchMap } from 'rxjs'; 

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
    BackToTopComponent
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

  private fetch$ = new Subject<void>();
  private isFirstLoginEffect = true; // Cờ theo dõi effect lần đầu

  constructor() {
    effect(() => {
      const loggedIn = this.isLoggedIn();
      
      // 🛑 Bỏ qua lần chạy đầu tiên khi component vừa khởi tạo để không ghi đè mất Data cũ lúc back về
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
    // 1. Luôn thiết lập luồng lắng nghe gọi API
    this.fetch$.pipe(
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

    // 2. LOGIC KIỂM TRA VÀ PHỤC HỒI STATE
    if (this.communityService.shouldRestoreState && this.communityService.feedState.posts.length > 0) {
      const state = this.communityService.feedState;
      this.posts = state.posts;
      this.page = state.page;
      this.hasMore = state.hasMore;
      this.activeCategory = state.activeCategory;
      this.sort = state.sort;
      
      // Reset cờ để các lần nhấn vào Menu "Community" sau sẽ được load mới như bình thường
      this.communityService.shouldRestoreState = false;

      // Chờ Angular render DOM (các thẻ card bài viết) xong rồi mới cuộn
      this.cdr.detectChanges();
      setTimeout(() => {
        window.scrollTo({ top: state.scrollY, behavior: 'instant' });
      }, 50);
      
    } else {
      // Nếu không có State cũ (Ví dụ: F5 trang, hoặc nhấn từ Navbar vào) -> Load data mới
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

  likePost(postId: string): void {
    if (!this.isLoggedIn()) {
      this.openLoginModal();
      return;
    }

    this.communityService.likePost(postId).subscribe(res => {
      const post = this.posts.find(p => p.post_id === postId);
      if (post) {
        post.like_count = res.like_count;
        this.cdr.detectChanges();
      }
    });
  }

  goToDetail(postId: string): void {
    // 🚀 LƯU TRỮ VỊ TRÍ SCROLL VÀ TOÀN BỘ DATA HIỆN TẠI TRƯỚC KHI RỜI ĐI 🚀
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

