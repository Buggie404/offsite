import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import {
  LucideHeart, LucideClock, LucideStar, LucideDroplet,
  LucideBookOpen, LucidePackage, LucideChefHat, LucideArrowRight, LucideBookmark
} from '@lucide/angular';
import { ProductService } from '../../../features/home/services/product.service';
import { RecipeService } from '../../../features/home/services/recipe.service';
import { ContentService } from '../../../features/content/services/content.service';
import { AuthService } from '../../../core/auth.service';
import { AuthPromptModalService } from '../auth-prompt-modal/auth-prompt-modal.service';
import { Product } from '../../../features/home/models/product.model';
import { Recipe } from '../../../features/home/models/recipe.model';
import { ProductCardComponent } from '../../../features/shop/components/product-card/product-card.component';
import { FooterComponent } from '../footer/footer.component';
import { BackToTopComponent } from '../back-to-top/back-to-top.component';

@Component({
  selector: 'app-search-results',
  standalone: true,
  imports: [
    CommonModule, RouterLink, LucideHeart, LucideClock,
    LucideStar, LucideDroplet, LucideBookOpen, LucidePackage, LucideChefHat,
    LucideArrowRight, LucideBookmark, ProductCardComponent, FooterComponent,
    BackToTopComponent
  ],
  templateUrl: './search-results.component.html',
  styleUrls: ['./search-results.component.scss']
})
export class SearchResultsComponent implements OnInit, OnDestroy {
  searchQuery = '';
  activeTab: 'PRODUCTS' | 'JOURNAL' | 'RECIPES' = 'PRODUCTS';

  allProducts: Product[] = [];
  allRecipes: Recipe[] = [];
  allBlogs: any[] = [];

  filteredProducts: Product[] = [];
  filteredRecipes: Recipe[] = [];
  filteredBlogs: any[] = [];

  savedProductIds = new Set<number>();
  savedBlogIds: string[] = [];
  savedRecipeIds = new Set<any>();
  isLoading = true;

  private platformId = inject(PLATFORM_ID);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private recipeService: RecipeService,
    private contentService: ContentService,
    private authService: AuthService,
    private authPromptService: AuthPromptModalService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.searchQuery = params['q'] || '';
      const tabParam = params['tab'];
      if (tabParam === 'PRODUCTS' || tabParam === 'JOURNAL' || tabParam === 'RECIPES') {
        this.activeTab = tabParam;
      }
      this.loadAllData();
    });

    if (isPlatformBrowser(this.platformId)) {
      this.loadSavedProducts();
      this.loadSavedBlogs();
      this.loadSavedRecipes();
    }
  }

  loadSavedBlogs(): void {
    if (this.authService.isAuthenticated()) {
      this.http.get<{ user: any }>('/api/auth/me').subscribe({
        next: (response) => {
          if (response.user && response.user.saved_blogs) {
            this.savedBlogIds = response.user.saved_blogs.map((sb: any) => sb.blog_id || sb._id);
            this.mapBlogs();
            this.cdr.markForCheck();
          }
        }
      });
    }
  }

  loadSavedRecipes(): void {
    if (this.authService.isAuthenticated()) {
      this.http.get<any>('/api/auth/saved-items').subscribe({
        next: (res) => {
          this.savedRecipeIds = new Set((res.saved_recipes || []).map((sr: any) => sr.recipe?.recipe_id).filter(Boolean));
          this.mapRecipes();
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.error('Error fetching saved recipes:', err);
        }
      });
    }
  }

  loadAllData(): void {
    this.isLoading = true;

    forkJoin({
      products: this.productService.getProducts(),
      recipes: this.recipeService.getRecipes(100),
      blogs: this.contentService.getBlogs({ limit: 100 })
    }).subscribe({
      next: (res) => {
        this.allProducts = res.products;
        this.allRecipes = res.recipes;
        this.allBlogs = res.blogs.data || [];
        this.filterResults();
        this.isLoading = false;
        this.cdr.markForCheck();
        this.restoreScrollPosition();
      },
      error: (err: any) => {
        console.error('Error loading search data:', err);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  filterResults(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredProducts = [];
      this.filteredRecipes = [];
      this.filteredBlogs = [];
      return;
    }

    const keywords = q.split(/\s+/).filter(Boolean);

    this.filteredProducts = this.allProducts.filter(p => {
      const searchableText = `${p.name || ''} ${p.description || ''} ${p.category || ''}`.toLowerCase();
      return keywords.every(kw => searchableText.includes(kw));
    });

    this.mapRecipes();
    this.mapBlogs();
  }

  mapRecipes(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredRecipes = [];
      return;
    }
    const keywords = q.split(/\s+/).filter(Boolean);

    const matchingRecipes = this.allRecipes.filter(r => {
      const tagsStr = (r.metadata?.tags || []).join(' ');
      const searchableText = `${r.title || ''} ${r.description || ''} ${tagsStr}`.toLowerCase();
      return keywords.every(kw => searchableText.includes(kw));
    });

    matchingRecipes.forEach(r => {
      (r as any).isFavorited = this.savedRecipeIds.has(r.recipe_id);
    });

    this.filteredRecipes = matchingRecipes;
  }

  mapBlogs(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredBlogs = [];
      return;
    }
    const keywords = q.split(/\s+/).filter(Boolean);

    const matchingBlogs = this.allBlogs.filter(b => {
      const tagsStr = (b.tags || []).join(' ');
      const searchableText = `${b.title || ''} ${b.excerpt || ''} ${tagsStr} ${b.category || ''}`.toLowerCase();
      return keywords.every(kw => searchableText.includes(kw));
    });

    this.filteredBlogs = matchingBlogs.map((blog: any, index: number) => {
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
        bookmarked: this.savedBlogIds.includes(blog._id),
        tags: blog.tags || []
      };
    });
  }

  get totalResultsCount(): number {
    return this.filteredProducts.length + this.filteredBlogs.length + this.filteredRecipes.length;
  }

  setActiveTab(tab: 'PRODUCTS' | 'JOURNAL' | 'RECIPES'): void {
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab },
      queryParamsHandling: 'merge'
    });
  }

  restoreScrollPosition(): void {
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        const savedScroll = sessionStorage.getItem(`search_scroll_${this.searchQuery}_${this.activeTab}`);
        if (savedScroll) {
          const scrollY = parseInt(savedScroll, 10);
          if (!isNaN(scrollY)) {
            window.scrollTo(0, scrollY);
          }
          sessionStorage.removeItem(`search_scroll_${this.searchQuery}_${this.activeTab}`);
        }
      }, 100);
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      const scrollPos = window.scrollY || window.pageYOffset;
      sessionStorage.setItem(`search_scroll_${this.searchQuery}_${this.activeTab}`, scrollPos.toString());
    }
  }

  // Saved Products management
  isProductSaved(product: Product): boolean {
    return this.savedProductIds.has(product.product_id);
  }

  async onProductSave(product: Product): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(product.product_id);
      if (result.saved) this.savedProductIds.add(product.product_id);
      else this.savedProductIds.delete(product.product_id);
      this.cdr.markForCheck();
    } catch (err: any) {
      console.error('Failed to save product:', err);
    }
  }

  private async loadSavedProducts(): Promise<void> {
    if (!this.authService.isAuthenticated()) return;

    try {
      const result = await this.authService.getSavedItems();
      this.savedProductIds = new Set(
        (result.saved_products || [])
          .map((item: any) => Number(item.product?.product_id ?? item.product_id))
          .filter((id: number) => !Number.isNaN(id))
      );
      this.cdr.markForCheck();
    } catch (err: any) {
      console.error('Failed to load saved products:', err);
    }
  }

  // Helper methods for recipes & blogs
  getRecipeBaseLabel(recipe: Recipe): string {
    const titleLower = recipe.title.toLowerCase();
    const hasMatcha = titleLower.includes('matcha') || recipe.metadata.tags.some((t: string) => t.toLowerCase() === 'matcha');
    if (hasMatcha) return 'Matcha';
    const hasCoffee = titleLower.includes('coffee') || recipe.metadata.tags.some((t: string) => t.toLowerCase() === 'coffee');
    if (hasCoffee) return 'Coffee';
    return 'Others';
  }

  getDifficultyLabel(recipe: Recipe): string {
    const map: Record<string, string> = {
      EASY:   'Easy',
      MEDIUM: 'Medium',
      HARD:   'Advanced',
    };
    return map[recipe.metadata.difficulty] ?? recipe.metadata.difficulty;
  }

  getBlogBadgeStyles(category: string): any {
    const cat = category.toLowerCase();
    if (cat.includes('matcha')) return { backgroundColor: '#E2F0D9', color: '#385623' };
    if (cat.includes('coffee')) return { backgroundColor: '#FCE4D6', color: '#C65911' };
    return { backgroundColor: '#E8F1F5', color: '#1F4E79' };
  }

  getBadgeLabel(recipe: Recipe): string {
    return recipe.metadata.tags.find((t: string) => ['HOT', 'COLD', 'DESSERT', 'COCKTAIL'].includes(t)) || '';
  }

  getBadgeColor(recipe: Recipe): string {
    const tag = this.getBadgeLabel(recipe);
    const map: Record<string, string> = {
      HOT:      '#EFB5D0',
      COLD:     '#CFE1B9',
      DESSERT:  '#E8D5B0',
      COCKTAIL: '#CFE1B9',
    };
    return map[tag] ?? '#CFE1B9';
  }

  toggleFavorite(recipe: Recipe, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    this.http.post<any>('/api/auth/saved-recipes', { recipeId: recipe.recipe_id }).subscribe({
      next: (res) => {
        (recipe as any).isFavorited = res.saved;
        if (res.saved) {
          recipe.saves += 1;
          this.savedRecipeIds.add(recipe.recipe_id);
        } else {
          recipe.saves = Math.max(0, recipe.saves - 1);
          this.savedRecipeIds.delete(recipe.recipe_id);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to toggle favorite:', err);
      }
    });
  }

  isFavorited(recipe: Recipe): boolean {
    return (recipe as any).isFavorited || false;
  }

  toggleBookmark(article: any, event: Event): void {
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
}
