import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LucideSearch, LucideChevronDown, LucideBookmark, LucideArrowRight, LucideX, LucideSearchX, LucideRotateCcw } from '@lucide/angular';
import { ContentService } from '../../services/content.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';

interface Article {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string;
  category: string;
  readTime: string;
  authorName?: string;
  authorImage?: string;
  date: string;
  formattedMeta: string;
  featured: boolean;
  bookmarked: boolean;
  tags: string[];
}

@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LucideSearch,
    LucideChevronDown,
    LucideBookmark,
    LucideArrowRight,
    LucideX,
    LucideSearchX,
    LucideRotateCcw,
    BackToTopComponent
  ],
  templateUrl: './journal.component.html',
  styleUrl: './journal.component.scss'
})
export class JournalComponent implements OnInit, OnDestroy {
  private contentService = inject(ContentService);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private authPromptService = inject(AuthPromptModalService);
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  constructor() {}

  savedBlogIds: string[] = [];
  selectedCategory = 'ALL';
  searchQuery = '';
  selectedSort = 'NEWEST';
  isSortDropdownOpen = false;

  categories = ['ALL', 'STORIES', 'BREWING GUIDES', 'TEA EDUCATION'];

  currentPage = 1;
  totalPages = 1;
  hasMore = false;
  articles: Article[] = [];
  isLoading = false;
  errorMessage = '';
  hasSearchPerformed = false;

  get pageLimit(): number {
    if (this.currentPage === 1) {
      const hasFeatured = (this.selectedCategory === 'ALL' && !this.searchQuery && this.selectedSort === 'NEWEST');
      return hasFeatured ? 7 : 6;
    }
    return 6;
  }

  get pageSkip(): number {
    if (this.currentPage === 1) {
      return 0;
    }
    const hasFeatured = (this.selectedCategory === 'ALL' && !this.searchQuery && this.selectedSort === 'NEWEST');
    return hasFeatured ? (7 + (this.currentPage - 2) * 6) : ((this.currentPage - 1) * 6);
  }

  featuredArticle: Article | undefined;
  gridArticles: Article[] = [];

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  fetchSavedBlogs(): void {
    if (isPlatformBrowser(this.platformId) && this.authService.isAuthenticated()) {
      this.http.get<{ user: any }>('/api/auth/me').subscribe({
        next: (response) => {
          if (response.user && response.user.saved_blogs) {
            this.savedBlogIds = response.user.saved_blogs.map((sb: any) => sb.blog_id);
            // Update already loaded articles
            this.articles.forEach(article => {
              article.bookmarked = this.savedBlogIds.includes(article.id);
            });
            this.updateArticlesLayout();
            this.cdr.detectChanges();
          }
        }
      });
    }
  }

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadBlogs();
    });

    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['category']) {
        this.selectedCategory = params['category'].toUpperCase();
      }
    });

    if (isPlatformBrowser(this.platformId)) {
      this.fetchSavedBlogs();
      this.loadBlogs();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  updateArticlesLayout(): void {
    const showFeatured = this.selectedCategory === 'ALL' && !this.searchQuery && this.selectedSort === 'NEWEST';
    
    if (!showFeatured) {
      this.featuredArticle = undefined;
      this.gridArticles = this.articles;
    } else {
      this.featuredArticle = this.articles.find(a => a.featured);
      if (this.featuredArticle) {
        this.gridArticles = this.articles.filter(a => a.id !== this.featuredArticle!.id);
      } else {
        this.gridArticles = this.articles;
      }
    }
  }

  loadBlogs(): void {
    this.isLoading = true;
    this.errorMessage = '';
    if (this.searchQuery) {
      this.hasSearchPerformed = true;
    }

    const filters: any = {
      category: this.selectedCategory,
      search: this.searchQuery,
      sort: this.selectedSort,
      page: this.currentPage,
      limit: this.pageLimit,
      skip: this.pageSkip
    };

    this.contentService.getBlogs(filters).subscribe({
      next: (response) => {
        const fetched = response.data.map((blog: any, index: number) => {
          const imageUrl = blog.featured_image_url;
          const dateObj = new Date(blog.published_at || blog.created_at);
          const month = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const day = dateObj.toLocaleDateString('en-US', { day: '2-digit' });
          const formattedMeta = `${month} ${day} - ${blog.read_time_minutes} MIN READ`;

          return {
            id: blog._id || String(index + 1),
            slug: blog.slug || blog._id || String(index + 1),
            title: blog.title,
            description: blog.excerpt,
            image: imageUrl || 'assets/images/logo-mark-dark.svg',
            category: blog.category,
            readTime: `${blog.read_time_minutes} MIN READ`,
            authorName: blog.author?.author_name || 'Offsite Official',
            authorImage: blog.author?.author_avatar_url || 'assets/images/logo-mark-dark.svg',
            date: dateObj.toLocaleDateString('en-US', {
              month: 'short',
              day: '2-digit',
              year: 'numeric'
            }),
            formattedMeta,
            featured: this.currentPage === 1 && index === 0 && this.selectedCategory === 'ALL' && !this.searchQuery && this.selectedSort === 'NEWEST',
            bookmarked: this.savedBlogIds.includes(blog._id),
            tags: blog.tags || []
          };
        });
        
        if (this.currentPage === 1) {
          this.articles = fetched;
        } else {
          this.articles = [...this.articles, ...fetched];
        }

        this.updateArticlesLayout();

        this.totalPages = response.pagination.totalPages;
        this.hasMore = response.pagination.hasMore;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading blogs:', err);
        this.errorMessage = 'Failed to load journal articles.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
    this.currentPage = 1;
    this.loadBlogs();
  }

  toggleSortDropdown(): void {
    this.isSortDropdownOpen = !this.isSortDropdownOpen;
  }

  selectSort(sort: string): void {
    this.selectedSort = sort;
    this.isSortDropdownOpen = false;
    this.currentPage = 1;
    this.loadBlogs();
  }

  getSortLabel(): string {
    if (this.selectedSort === 'SHORTEST_READ') return 'SHORTEST READ';
    if (this.selectedSort === 'LONGEST_READ') return 'LONGEST READ';
    return this.selectedSort;
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery = input.value;
    this.onSearchChange();
  }

  onSearchChange(): void {
    this.currentPage = 1;
    this.searchSubject.next(this.searchQuery);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.currentPage = 1;
    this.hasSearchPerformed = false;
    this.loadBlogs();
  }

  toggleBookmark(article: Article, event: Event): void {
    event.stopPropagation();
    
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    
    this.http.post<any>('/api/auth/saved-blogs', { blogId: article.id }).subscribe({
      next: (res) => {
        article.bookmarked = res.saved;
        if (res.saved) {
          if (!this.savedBlogIds.includes(article.id)) {
            this.savedBlogIds.push(article.id);
          }
        } else {
          this.savedBlogIds = this.savedBlogIds.filter(id => id !== article.id);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error toggling bookmark:', err);
      }
    });
  }

  navigateToArticle(article: Article): void {
    console.log('Navigating to article:', article.slug || article.id);
    if (isPlatformBrowser(this.platformId)) {
      const slug = article.slug || article.id;
      console.log('Router navigate to:', '/journal/' + slug);
      this.router.navigate(['/journal', slug], {
        queryParams: { category: this.selectedCategory !== 'ALL' ? this.selectedCategory.toLowerCase() : null }
      });
    }
  }

  loadMore(): void {
    this.currentPage++;
    this.loadBlogs();
  }

  get showEmptyState(): boolean {
    const hasActiveFilters = !!this.searchQuery;
    return this.hasSearchPerformed && hasActiveFilters && this.articles.length === 0 && !this.isLoading;
  }

  onImgError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/images/logo-mark-dark.svg';
  }
}
