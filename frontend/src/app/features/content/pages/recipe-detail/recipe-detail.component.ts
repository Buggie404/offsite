import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { 
  LucideArrowLeft, 
  LucideClock, 
  LucideStar, 
  LucideHeart, 
  LucideDroplet, 
  LucideChevronDown, 
  LucideRotateCcw,
  LucideArrowUp,
  LucidePlay,
  LucidePause,
  LucideArrowRight
} from '@lucide/angular';
import { ContentService } from '../../services/content.service';
import { ProductService } from '../../../home/services/product.service';
import { Recipe, RecipeStep } from '../../../../shared/models/recipe.model';
import { Product, getDefaultPrice } from '../../../home/models/product.model';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LucideArrowLeft,
    LucideClock,
    LucideStar,
    LucideHeart,
    LucideDroplet,
    LucideChevronDown,
    LucideRotateCcw,
    LucideArrowUp,
    LucidePlay,
    LucidePause,
    LucideArrowRight
  ],
  templateUrl: './recipe-detail.component.html',
  styleUrl: './recipe-detail.component.scss'
})
export class RecipeDetailComponent implements OnInit, OnDestroy {
  private contentService = inject(ContentService);
  private productService = inject(ProductService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);
  private authService = inject(AuthService);
  private authPromptService = inject(AuthPromptModalService);
  private destroy$ = new Subject<void>();

  recipe: Recipe | null = null;
  relatedRecipes: Recipe[] = [];
  products: Product[] = [];
  isLoading = true;
  errorMessage = '';

  // Accordion state
  ingredientsOpen = true;
  stepsOpen = true;

  // Timer state
  timerDuration = 120; // Default 2 minutes
  timeLeft = 120;
  timerRunning = false;
  private timerInterval: any = null;

  showBackToTop = false;
  private scrollThreshold = 400;

  // Swatches for Coffee Roast level
  roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.showBackToTop = window.scrollY > this.scrollThreshold;
      this.cdr.detectChanges();
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
        this.loadRecipeDetail(slug);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearTimer();
  }

  loadRecipeDetail(slug: string): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.clearTimer();

    this.contentService.getRecipe(slug).pipe(takeUntil(this.destroy$)).subscribe({
      next: (recipe) => {
        this.recipe = recipe;
        
        // Find default timer duration from steps if available
        const stepWithTimer = recipe.steps.find((s: any) => s.timerSeconds || s.duration);
        if (stepWithTimer) {
          const secs = (stepWithTimer as any).timerSeconds || ((stepWithTimer as any).duration * 60) || 120;
          this.timerDuration = secs;
          this.timeLeft = secs;
        } else {
          // If no step timer, use the prepTime from header (converted to seconds)
          const prepTimeSecs = (recipe.metadata.prepTime || 2) * 60;
          this.timerDuration = prepTimeSecs;
          this.timeLeft = prepTimeSecs;
        }

        this.loadProducts(recipe.relatedProducts || []);
        this.loadRelatedRecipes(recipe._id);

        this.isLoading = false;
        
        // Scroll to top of the page when new recipe loads
        if (isPlatformBrowser(this.platformId)) {
          window.scrollTo({ top: 0, behavior: 'instant' as any });
        }

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading recipe:', err);
        this.errorMessage = 'Failed to load recipe detail. Please try again.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadProducts(relatedProductIds: string[]): void {
    this.productService.getProducts().pipe(takeUntil(this.destroy$)).subscribe({
      next: (allProducts) => {
        if (relatedProductIds && relatedProductIds.length > 0) {
          // Filter matching products
          this.products = allProducts.filter(p => relatedProductIds.includes(p.product_id.toString()) || relatedProductIds.includes(p._id || ''));
        }
        
        // Fallback: If no matching products found, show default ones to look premium
        if (this.products.length === 0) {
          this.products = allProducts.slice(0, 4);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading products:', err);
      }
    });
  }

  loadRelatedRecipes(excludeId: string): void {
    if (!this.recipe) return;
    const currentBase = this.getRecipeBaseLabel(this.recipe);
    const currentStyle = this.getBadgeLabel(this.recipe);

    this.contentService.getRecipes().pipe(takeUntil(this.destroy$)).subscribe({
      next: (recipes) => {
        const filtered = recipes.filter(r => r._id !== excludeId);
        
        // Score based on matching base and serve style
        const scored = filtered.map(r => {
          let score = 0;
          if (this.getRecipeBaseLabel(r) === currentBase) score += 2;
          if (this.getBadgeLabel(r) === currentStyle) score += 1;
          return { recipe: r, score };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        this.relatedRecipes = scored.map(s => s.recipe).slice(0, 3);
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading related recipes:', err);
      }
    });
  }

  // --- Accordion Controls ---
  toggleIngredients(): void {
    this.ingredientsOpen = !this.ingredientsOpen;
  }

  toggleSteps(): void {
    this.stepsOpen = !this.stepsOpen;
  }

  getStepTimerDuration(step: RecipeStep): number {
    if (step.timerSeconds) return step.timerSeconds;
    if (step.duration) return step.duration * 60;
    return 0;
  }

  startTimerForStep(step: RecipeStep): void {
    const secs = this.getStepTimerDuration(step);
    if (secs > 0) {
      this.timerDuration = secs;
      this.timeLeft = secs;
      this.startTimer();
    } else {
      this.timerDuration = 120;
      this.timeLeft = 120;
      this.startTimer();
    }
  }

  startTimer(): void {
    this.clearTimer();
    this.timerRunning = true;
    
    if (isPlatformBrowser(this.platformId)) {
      this.timerInterval = setInterval(() => {
        if (this.timeLeft > 0) {
          this.timeLeft--;
          this.cdr.detectChanges();
        } else {
          this.timerComplete();
        }
      }, 1000);
    }
  }

  toggleTimer(): void {
    if (this.timerRunning) {
      this.pauseTimer();
    } else {
      this.startTimer();
    }
  }

  pauseTimer(): void {
    this.timerRunning = false;
    this.clearTimer();
  }

  resetTimer(): void {
    this.timerRunning = false;
    this.clearTimer();
    this.timeLeft = this.timerDuration;
    this.cdr.detectChanges();
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private timerComplete(): void {
    this.timerRunning = false;
    this.clearTimer();
    this.playBeep();
    alert('Timer completed!');
    this.timeLeft = this.timerDuration;
    this.cdr.detectChanges();
  }

  playBeep(): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {
        console.warn('Web Audio beep failed:', e);
      }
    }
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // --- Recipe Helpers ---
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

  getDifficultyLabel(recipe: Recipe): string {
    const map: Record<string, string> = {
      EASY:   'Easy',
      MEDIUM: 'Medium',
      HARD:   'Advanced',
    };
    return map[recipe.metadata.difficulty] ?? recipe.metadata.difficulty;
  }

  getRecipeBaseLabel(recipe: Recipe): string {
    const titleLower = recipe.title.toLowerCase();
    const hasMatcha = titleLower.includes('matcha') || recipe.metadata.tags.some((t: string) => t.toLowerCase() === 'matcha');
    if (hasMatcha) return 'Matcha';
    const hasCoffee = titleLower.includes('coffee') || recipe.metadata.tags.some((t: string) => t.toLowerCase() === 'coffee');
    if (hasCoffee) return 'Coffee';
    return 'Others';
  }

  toggleFavorite(recipe: Recipe, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    if ((recipe as any).isFavorited) {
      (recipe as any).isFavorited = false;
      recipe.saves = Math.max(0, recipe.saves - 1);
    } else {
      (recipe as any).isFavorited = true;
      recipe.saves += 1;
    }
  }

  isFavorited(recipe: Recipe): boolean {
    return (recipe as any).isFavorited || false;
  }

  // --- Product Helpers ---
  getPrimaryImage(p: Product): string {
    return p.images[0]?.url ?? '';
  }

  getPrimaryImageAlt(p: Product): string {
    return p.images[0]?.alt_text ?? p.name;
  }

  getPrice(p: Product): string {
    return `$${getDefaultPrice(p).toFixed(2)}`;
  }

  getOrigin(p: Product): string {
    switch (p.category) {
      case 'matcha':     return p.matcha?.origin ?? '';
      case 'coffee':     return [p.coffee?.product_origin, p.coffee?.process_type]
                                  .filter(Boolean).join(' · ').toUpperCase();
      case 'tools':      return (p.tools?.tool_category ?? '').toUpperCase();
      case 'drinkware':  return (p.drinkware?.ware_type ?? '').toUpperCase();
      default:           return '';
    }
  }

  getTags(p: Product): string[] {
    switch (p.category) {
      case 'matcha':
        return p.matcha?.product_grade ? [p.matcha.product_grade] : [];
      case 'coffee':
        return p.coffee?.tasting_notes?.slice(0, 3) ?? [];
      case 'tools':
        return p.tools?.tool_type ? [p.tools.tool_type] : [];
      case 'drinkware':
        return p.drinkware?.material ? [p.drinkware.material] : [];
      case 'sets_bundles':
        const count = (p as any).sets_bundles?.composition?.length || 2;
        return [`${count} products`];
      default:
        return p.product_tag ?? [];
    }
  }

  showRoastBar(p: Product): boolean {
    return p.category === 'coffee';
  }

  getHighlightIndex(p: Product): number {
    const roast = (p.coffee?.roast_level ?? '').toLowerCase();
    if (roast.includes('dark') && roast.includes('medium')) return 6;
    if (roast.includes('dark'))   return 8;
    if (roast.includes('medium') && roast.includes('light')) return 3;
    if (roast.includes('medium')) return 5;
    return 1;
  }

  isHighlightSwatch(p: Product, index: number): boolean {
    return index === this.getHighlightIndex(p);
  }

  onAddToCart(p: Product): void {
    console.log('Add to cart:', p.name);
  }

  onSaveProduct(p: Product, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    console.log('Save product:', p.name);
  }

  goBack(): void {
    this.router.navigate(['/recipes']);
  }
}
