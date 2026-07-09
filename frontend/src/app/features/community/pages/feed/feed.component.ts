import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
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

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [
    CommonModule,
    HeroBannerComponent,
    FeedToolbarComponent,
    PostCardComponent,
    CreatePostModalComponent,
    CreateRecipeModalComponent
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

  // Signal có sẵn từ AuthService, tự động cập nhật khi login/logout
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

  ngOnInit(): void {
    // Chỉ load feed nếu đã login, tránh gọi API thừa khi user chưa xác thực
    if (!this.isLoggedIn()) return;

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
    this.showCreatePost = true;
  }

  closeCreatePost(): void {
    this.showCreatePost = false;
  }

  openCreateRecipe(): void {
    this.showCreateRecipe = true;
  }

  closeCreateRecipe(): void {
    this.showCreateRecipe = false;
  }
}