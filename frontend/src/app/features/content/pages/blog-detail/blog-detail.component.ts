import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LucideArrowLeft, LucideBookmark, LucideClock, LucideCalendar, LucideAlertCircle, LucideLink, LucideArrowRight } from '@lucide/angular';
import { ContentService } from '../../services/content.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';

interface Article {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: any[];
  image: string;
  category: string;
  readTime: string;
  readTimeMinutes: number;
  authorName?: string;
  authorImage?: string;
  date: string;
  formattedMeta: string;
  tags: string[];
  viewsCount: number;
  likesCount: number;
}

interface RelatedArticle {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string;
  category: string;
  readTime: string;
  date: string;
  formattedMeta: string;
  bookmarked: boolean;
  tags: string[];
}

@Component({
  selector: 'app-blog-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LucideArrowLeft,
    LucideBookmark,
    LucideClock,
    LucideCalendar,
    LucideAlertCircle,
    LucideLink,
    LucideArrowRight,
    BackToTopComponent
  ],
  templateUrl: './blog-detail.component.html',
  styleUrl: './blog-detail.component.scss'
})
export class BlogDetailComponent implements OnInit, OnDestroy {
  private contentService = inject(ContentService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();
  private authPromptService = inject(AuthPromptModalService);
  private authService = inject(AuthService);
  private http = inject(HttpClient);

  savedBlogIds: string[] = [];
  article: Article | null = null;
  relatedArticles: RelatedArticle[] = [];
  isLoading = true;
  errorMessage = '';
  isBookmarked = false;
  categoryFilter: string | null = null;
  primaryTag: string | null = null;

  fetchSavedBlogs(): void {
    if (isPlatformBrowser(this.platformId) && this.authService.isAuthenticated()) {
      this.http.get<{ user: any }>('/api/auth/me').subscribe({
        next: (response) => {
          if (response.user && response.user.saved_blogs) {
            this.savedBlogIds = response.user.saved_blogs.map((sb: any) => sb.blog_id);
            if (this.article) {
              this.isBookmarked = this.savedBlogIds.includes(this.article.id);
            }
            this.relatedArticles.forEach(rel => {
              rel.bookmarked = this.savedBlogIds.includes(rel.id);
            });
            this.cdr.detectChanges();
          }
        }
      });
    }
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(queryParams => {
      this.categoryFilter = queryParams['category'] || null;
    });

    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const slug = params['slug'];
      if (slug) {
        this.loadBlogDetail(slug);
      }
    });

    this.fetchSavedBlogs();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadBlogDetail(slug: string): void {
    console.log('BlogDetail: Loading blog with slug:', slug);
    this.isLoading = true;
    this.errorMessage = '';

    this.contentService.getBlogBySlug(slug).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blog: any) => {
        const dateObj = new Date(blog.published_at || blog.created_at);
        const month = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const day = dateObj.toLocaleDateString('en-US', { day: '2-digit' });
        const formattedMeta = `${month} ${day} - ${blog.read_time_minutes} MIN READ`;

        this.article = {
          id: blog._id || '',
          slug: blog.slug,
          title: blog.title,
          description: blog.excerpt || '',
          content: blog.content || [],
          image: blog.featured_image_url || 'assets/images/logo-mark-dark.svg',
          category: blog.category,
          readTime: `${blog.read_time_minutes} MIN READ`,
          readTimeMinutes: blog.read_time_minutes || 0,
          authorName: blog.author?.author_name || 'Offsite Official',
          authorImage: blog.author?.author_avatar_url || 'assets/images/logo-mark-dark.svg',
          date: dateObj.toLocaleDateString('en-US', {
            month: 'long',
            day: '2-digit',
            year: 'numeric'
          }),
          formattedMeta,
          tags: blog.tags || [],
          viewsCount: blog.views_count || 0,
          likesCount: blog.likes_count || 0
        };

        if (this.article.tags && this.article.tags.length > 0) {
          this.primaryTag = this.article.tags[0];
        }
        this.isBookmarked = this.savedBlogIds.includes(this.article.id);
        this.loadRelatedArticles(this.article.category, this.article.id);

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading blog:', err);
        this.errorMessage = 'Failed to load article.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadRelatedArticles(category: string, excludeId: string): void {
    this.contentService.getBlogs({
      category: category,
      limit: 10
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        const related = response.data.filter((blog: any) => blog._id !== excludeId);

        const mapToRelatedArticle = (blog: any) => {
          const dateObj = new Date(blog.published_at || blog.created_at);
          const month = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const day = dateObj.toLocaleDateString('en-US', { day: '2-digit' });

          return {
            id: blog._id,
            slug: blog.slug,
            title: blog.title,
            description: blog.excerpt || '',
            image: blog.featured_image_url || 'assets/images/logo-mark-dark.svg',
            category: blog.category,
            readTime: `${blog.read_time_minutes} MIN READ`,
            date: dateObj.toLocaleDateString('en-US', {
              month: 'short',
              day: '2-digit',
              year: 'numeric'
            }),
            formattedMeta: `${month} ${day} - ${blog.read_time_minutes} MIN READ`,
            bookmarked: this.savedBlogIds.includes(blog._id),
            tags: blog.tags || []
          };
        };

        if (related.length < 3) {
          // Fallback: Fetch general latest articles to fill the gap
          this.contentService.getBlogs({
            limit: 10
          }).pipe(takeUntil(this.destroy$)).subscribe({
            next: (fallbackResponse) => {
              const extraArticles = fallbackResponse.data
                .filter((blog: any) => blog._id !== excludeId && !related.some(r => r._id === blog._id));
              
              const combined = [...related, ...extraArticles].slice(0, 3);
              this.relatedArticles = combined.map(mapToRelatedArticle);
              this.cdr.detectChanges();
            },
            error: (err) => {
              console.error('Error loading fallback related articles:', err);
              this.relatedArticles = related.slice(0, 3).map(mapToRelatedArticle);
              this.cdr.detectChanges();
            }
          });
        } else {
          this.relatedArticles = related.slice(0, 3).map(mapToRelatedArticle);
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.error('Error loading related articles:', err);
      }
    });
  }

  goBack(): void {
    if (isPlatformBrowser(this.platformId)) {
      const navigationExtras: any = {};
      if (this.categoryFilter) {
        navigationExtras.queryParams = { category: this.categoryFilter };
      }
      this.router.navigate(['/journal'], navigationExtras);
    }
  }

  navigateToArticle(slug: string): void {
    if (isPlatformBrowser(this.platformId)) {
      const navigationExtras: any = {};
      if (this.categoryFilter) {
        navigationExtras.queryParams = { category: this.categoryFilter };
      }
      this.router.navigate(['/journal', slug], navigationExtras);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  toggleBookmark(): void {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    if (!this.article) return;
    
    this.http.post<any>('/api/auth/saved-blogs', { blogId: this.article.id }).subscribe({
      next: (res) => {
        this.isBookmarked = res.saved;
        if (res.saved) {
          if (!this.savedBlogIds.includes(this.article!.id)) {
            this.savedBlogIds.push(this.article!.id);
          }
        } else {
          this.savedBlogIds = this.savedBlogIds.filter(id => id !== this.article!.id);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error toggling bookmark:', err);
      }
    });
  }

  toggleRelatedBookmark(related: RelatedArticle, event: Event): void {
    event.stopPropagation();
    
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    
    this.http.post<any>('/api/auth/saved-blogs', { blogId: related.id }).subscribe({
      next: (res) => {
        related.bookmarked = res.saved;
        if (res.saved) {
          if (!this.savedBlogIds.includes(related.id)) {
            this.savedBlogIds.push(related.id);
          }
        } else {
          this.savedBlogIds = this.savedBlogIds.filter(id => id !== related.id);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error toggling related bookmark:', err);
      }
    });
  }

  getCategoryClass(category: string): string {
    return category.toLowerCase().replace(/ /g, '-');
  }

  getCategoryColor(category: string): string {
    const cat = category.toLowerCase();
    if (cat.includes('stories')) return '#FFFFFF';
    if (cat.includes('brewing')) return '#544A40';
    if (cat.includes('tea')) return '#CFE1B9';
    return '#FFFFFF';
  }

  getCategoryTextColor(category: string): string {
    const cat = category.toLowerCase();
    if (cat.includes('stories')) return '#544A40';
    if (cat.includes('brewing')) return '#FAF0EB';
    if (cat.includes('tea')) return '#375534';
    return '#544A40';
  }

  getTagColor(tag: string): string {
    if (this.article) {
      return this.getCategoryColor(this.article.category);
    }
    return '#544A40';
  }

  getTagTextColor(tag: string): string {
    if (this.article) {
      return this.getCategoryTextColor(this.article.category);
    }
    return '#FAF0EB';
  }

  onImgError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/images/logo-mark-dark.svg';
  }
}
