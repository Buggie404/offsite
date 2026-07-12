import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LucideArrowLeft, LucideBookmark, LucideClock, LucideCalendar, LucideAlertCircle, LucideLink, LucideArrowRight, LucideCheck } from '@lucide/angular';
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
    LucideCheck,
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

  copied = false;
  savedBlogIds: string[] = [];
  article: Article | null = null;
  relatedArticles: RelatedArticle[] = [];
  isLoading = true;
  errorMessage = '';
  isBookmarked = false;
  categoryFilter: string | null = null;
  primaryTag: string | null = null;
  private pendingFragment: string | null = null;

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

    this.route.fragment.pipe(takeUntil(this.destroy$)).subscribe(fragment => {
      this.pendingFragment = fragment || null;
      this.scrollToPendingFragment();
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
        this.scrollToPendingFragment();
      },
      error: (err) => {
        console.error('Error loading blog:', err);
        if (err?.status === 404) {
          void this.router.navigateByUrl('/404', { skipLocationChange: true });
        } else {
          this.errorMessage = 'Failed to load article.';
          this.isLoading = false;
          this.cdr.detectChanges();
        }
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

  private location = inject(Location);

  goBack(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (this.isProductDetailEntry()) {
        const navigationExtras: any = {};
        if (this.categoryFilter) {
          navigationExtras.queryParams = { category: this.categoryFilter };
        }
        void this.router.navigate(['/journal'], navigationExtras);
        return;
      }

      if (window.history.length > 1) {
        this.location.back();
      } else {
        const navigationExtras: any = {};
        if (this.categoryFilter) {
          navigationExtras.queryParams = { category: this.categoryFilter };
        }
        void this.router.navigate(['/journal'], navigationExtras);
      }
    }
  }

  private isProductDetailEntry(): boolean {
    const navigationState = this.router.getCurrentNavigation()?.extras.state;
    const currentState = window.history.state;

    return navigationState?.['contentEntrySource'] === 'product-detail'
      || currentState?.['contentEntrySource'] === 'product-detail';
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

  getContentBlockId(block: any, index: number): string | null {
    if (block?.type !== 'heading') return null;
    return this.buildJournalStepAnchor(block?.text, index);
  }

  onImgError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/images/logo-mark-dark.svg';
  }

  private scrollToPendingFragment(): void {
    if (!this.pendingFragment || !this.article || !isPlatformBrowser(this.platformId)) return;

    const fragment = this.pendingFragment;
    const isGuideNavigation = /^guide-step-\d+$/.test(fragment);

    // A Step-by-Step Guide click intentionally starts at the article header,
    // then makes one smooth pass to the requested step. This shows users what
    // the CTA does without the old competing scroll animations.
    if (isGuideNavigation) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = this.getFragmentTarget(fragment);
        if (!target) return;

        const topOffset = this.getStickyHeaderOffset();
        const top = target.getBoundingClientRect().top + window.scrollY - topOffset;
        window.scrollTo({
          top: Math.max(0, top),
          behavior: isGuideNavigation ? 'smooth' : 'auto'
        });
      });
    });
  }

  private getFragmentTarget(fragment: string): HTMLElement | null {
    const directTarget = document.getElementById(fragment);
    if (directTarget) return directTarget;

    const guideStepMatch = /^guide-step-(\d+)$/.exec(fragment);
    if (!guideStepMatch || !this.article) return null;

    const requestedStep = Number(guideStepMatch[1]);
    let guideStepNumber = 0;

    for (let index = 0; index < this.article.content.length; index++) {
      const block = this.article.content[index];
      if (block?.type !== 'heading' || !this.isGuideStepHeading(block?.text)) continue;

      guideStepNumber++;
      if (guideStepNumber === requestedStep) {
        const sectionHeading = requestedStep === 1
          ? this.getGuideSectionHeading(index)
          : null;

        if (sectionHeading) return sectionHeading;
        return document.getElementById(this.buildJournalStepAnchor(block.text, index));
      }
    }

    return null;
  }

  private getGuideSectionHeading(firstStepIndex: number): HTMLElement | null {
    if (!this.article) return null;

    for (let index = firstStepIndex - 1; index >= 0; index--) {
      const block = this.article.content[index];
      if (block?.type !== 'heading') continue;
      if (this.isGuideStepHeading(block?.text)) break;

      const heading = String(block?.text ?? '').trim();
      if (/\bstep\s*by\s*step\b|\binstructions?\b|\bmethod\b/i.test(heading)) {
        return document.getElementById(this.buildJournalStepAnchor(block.text, index));
      }
    }

    return null;
  }

  private getStickyHeaderOffset(): number {
    const navbar = document.querySelector('app-navbar') as HTMLElement | null;
    const navbarHeight = navbar?.getBoundingClientRect().height ?? 0;
    return Math.ceil(navbarHeight) + 28;
  }

  private isGuideStepHeading(value: unknown): boolean {
    return /^(?:(?:step|method)\s*)?\d+[\).\s:-]+/i.test(String(value ?? '').trim());
  }

  private buildJournalStepAnchor(value: unknown, index: number): string {
    const slug = this.normalizeStepHeading(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `journal-step-${index}-${slug || 'guide'}`;
  }

  private normalizeStepHeading(value: unknown): string {
    return String(value ?? '')
      .replace(/^\s*(?:(?:step|method)\s*)?\d+[\).\s:-]+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  shareFacebook(): void {
    if (isPlatformBrowser(this.platformId)) {
      const url = encodeURIComponent(window.location.href);
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener,noreferrer');
    }
  }

  shareTwitter(): void {
    if (isPlatformBrowser(this.platformId)) {
      const url = encodeURIComponent(window.location.href);
      const text = encodeURIComponent(this.article?.title || '');
      window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'noopener,noreferrer');
    }
  }

  private copyTimeout: any;

  copyLink(): void {
    if (isPlatformBrowser(this.platformId)) {
      const url = window.location.href;
      this.showCopiedState();

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(() => {
          this.fallbackCopyText(url);
        });
      } else {
        this.fallbackCopyText(url);
      }
    }
  }

  private fallbackCopyText(text: string): void {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback copy failed', err);
      this.copied = false;
      this.cdr.detectChanges();
      if (this.copyTimeout) {
        clearTimeout(this.copyTimeout);
      }
    }
    document.body.removeChild(textArea);
  }

  private showCopiedState(): void {
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
    }
    this.copied = true;
    this.cdr.detectChanges();
    this.copyTimeout = setTimeout(() => {
      this.copied = false;
      this.cdr.detectChanges();
    }, 1000);
  }
}
