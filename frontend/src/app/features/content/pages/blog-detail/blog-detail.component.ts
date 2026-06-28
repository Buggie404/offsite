import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { LucideArrowLeft, LucideBookmark, LucideClock, LucideCalendar, LucideAlertCircle } from '@lucide/angular';
import { ContentService } from '../../services/content.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
    LucideAlertCircle
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

  article: Article | null = null;
  relatedArticles: RelatedArticle[] = [];
  isLoading = true;
  errorMessage = '';
  isBookmarked = false;
  showBackToTop = false;
  primaryTag: string | null = null;
  private scrollThreshold = 400;

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.showBackToTop = window.scrollY > this.scrollThreshold;
    }
  }

  scrollToTop(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const slug = params['slug'];
      if (slug) {
        this.loadBlogDetail(slug);
      }
    });
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
          this.loadRelatedArticles(this.article.tags, this.article.id);
        }

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

  loadRelatedArticles(tags: string[], excludeId: string): void {
    const primaryTag = tags[0];

    this.contentService.getBlogs({
      tag: primaryTag,
      limit: 4
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        const related = response.data
          .filter((blog: any) => blog._id !== excludeId)
          .slice(0, 3)
          .map((blog: any) => {
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
              bookmarked: false,
              tags: blog.tags || []
            };
          });

        this.relatedArticles = related;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading related articles:', err);
      }
    });
  }

  goBack(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.router.navigate(['/journal']);
    }
  }

  navigateToArticle(slug: string): void {
    if (isPlatformBrowser(this.platformId)) {
      this.router.navigate(['/journal', slug]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  toggleBookmark(): void {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    this.isBookmarked = !this.isBookmarked;
  }

  toggleRelatedBookmark(related: RelatedArticle, event: Event): void {
    event.stopPropagation();
    
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    
    related.bookmarked = !related.bookmarked;
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
