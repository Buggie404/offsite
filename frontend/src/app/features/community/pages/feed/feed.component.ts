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

  constructor() {
    // Tự động gọi API lấy data thật của User ngay khi đăng nhập thành công
    effect(() => {
      const loggedIn = this.isLoggedIn();
      if (loggedIn) {
        this.page = 1;
        this.loadFeed();
      }
    });
  }

  ngOnInit(): void {
    // Không chặn Guest ở đây nữa, gọi API bình thường để có data nền mờ
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

    this.loadFeed();
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
    // Chặn Like nếu chưa đăng nhập (đề phòng click lọt qua lớp mờ)
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

