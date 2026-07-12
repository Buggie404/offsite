import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { 
  LucideArrowLeft, 
  LucideClock, 
  LucideStar, 
  LucideHeart, 
  LucideDroplet, 
  LucideChevronDown, 
  LucideRotateCcw,
  LucidePlay,
  LucidePause,
  LucideArrowRight
} from '@lucide/angular';
import { ContentService } from '../../services/content.service';
import { ProductService } from '../../../home/services/product.service';
import { Recipe, RecipeStep } from '../../../../shared/models/recipe.model';
import { Product, getDefaultPrice, isProductOutOfStock } from '../../../home/models/product.model';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';
import { ProductCardComponent } from '../../../shop/components/product-card/product-card.component';

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
    LucidePlay,
    LucidePause,
    LucideArrowRight,
    BackToTopComponent,
    ProductCardComponent
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
  private http = inject(HttpClient);
  private destroy$ = new Subject<void>();

  recipe: Recipe | null = null;
  relatedRecipes: Recipe[] = [];
  savedRecipeIds = new Set<string>();
  savedProductIds = new Set<number>();
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
  showFloatingTimer = false;
  isAlarming = false;
  private alarmInterval: any = null;
  private alarmAudioCtx: AudioContext | null = null;

  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.querySelector('.main-content-section');
      if (element) {
        const rect = element.getBoundingClientRect();
        this.showFloatingTimer = rect.top < window.innerHeight;
      } else {
        this.showFloatingTimer = window.scrollY > 400;
      }
    }
  }

  // Swatches for Coffee Roast level
  roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const slug = params['slug'];
      if (slug) {
        this.loadRecipeDetail(slug);
        if (isPlatformBrowser(this.platformId)) {
          this.loadSavedProducts();
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearTimer();
    this.stopAlarm();
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

        if (this.authService.isAuthenticated()) {
          this.http.get<any>('/api/auth/saved-items').subscribe({
            next: (res) => {
              this.savedRecipeIds = new Set<string>((res.saved_recipes || []).map((sr: any) => sr.recipe?.recipe_id).filter(Boolean));
              if (this.recipe) {
                (this.recipe as any).isFavorited = this.savedRecipeIds.has(this.recipe.recipe_id);
              }
              this.isLoading = false;
              this.cdr.detectChanges();
            },
            error: (err) => {
              console.error('Failed to fetch saved recipes for detail:', err);
              this.isLoading = false;
              this.cdr.detectChanges();
            }
          });
        } else {
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.error('Error loading recipe:', err);
        if (err?.status === 404) {
          void this.router.navigateByUrl('/404', { skipLocationChange: true });
        } else {
          this.errorMessage = 'Failed to load recipe detail. Please try again.';
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      }
    });
  }

  loadProducts(relatedProductIds: string[]): void {
    this.productService.getProducts().pipe(takeUntil(this.destroy$)).subscribe({
      next: (allProducts) => {
        const currentBase = this.recipe ? this.getRecipeBaseLabel(this.recipe) : 'Others';
        const targetCategories = ['matcha', 'coffee', 'tools', 'drinkware', 'sets_bundles'];
        const selectedProducts: Product[] = [];

        // Helper to check if a product is relevant to the recipe base category
        const isThemeRelevant = (p: Product, base: string): boolean => {
          const nameLower = p.name.toLowerCase();
          const descLower = (p.description || '').toLowerCase();
          const tags = (p.product_tag || []).map(t => t.toLowerCase());

          if (base === 'Matcha') {
            const teaKeywords = ['matcha', 'hojicha', 'sencha', 'genmaicha', 'tea', 'green tea'];
            const hasMatchaKeyword = teaKeywords.some(kw => nameLower.includes(kw)) ||
                                     nameLower.includes('chasen') || 
                                     nameLower.includes('chawan') || 
                                     nameLower.includes('whisk') || 
                                     nameLower.includes('sifter') || 
                                     nameLower.includes('bowl') ||
                                     teaKeywords.some(kw => descLower.includes(kw)) ||
                                     tags.some(t => teaKeywords.includes(t));
            const isMatchaTool = p.category === 'tools' && p.tools?.tool_category === 'matcha-tools';
            return hasMatchaKeyword || isMatchaTool;
          } else if (base === 'Coffee') {
            const hasCoffeeKeyword = nameLower.includes('coffee') || 
                                     nameLower.includes('dripper') || 
                                     nameLower.includes('grinder') || 
                                     nameLower.includes('filter') || 
                                     nameLower.includes('kettle') || 
                                     nameLower.includes('scale') ||
                                     nameLower.includes('espresso') ||
                                     nameLower.includes('mug') ||
                                     nameLower.includes('cup') ||
                                     descLower.includes('coffee') ||
                                     tags.includes('coffee');
            const isCoffeeTool = p.category === 'tools' && p.tools?.tool_category === 'coffee-tools';
            return hasCoffeeKeyword || isCoffeeTool;
          }
          return false;
        };

        // For each of the 5 categories, find the best product and its score
        const categoryRepresentatives: { product: Product, score: number }[] = [];

        for (const cat of targetCategories) {
          const catProducts = allProducts.filter(p => p.category === cat && !isProductOutOfStock(p));
          if (catProducts.length === 0) continue;

          // Score each product in this category
          const scoredCatProducts = catProducts.map(p => {
            let score = 0;
            
            // 1. Explicitly defined in recipe relatedProducts gets highest priority
            if (relatedProductIds && (relatedProductIds.includes(p.product_id.toString()) || relatedProductIds.includes(p._id || ''))) {
              score += 100;
            }

            // 2. Relevance to the recipe base category
            if (currentBase !== 'Others' && isThemeRelevant(p, currentBase)) {
              score += 20;
            }

            // 3. Popularity/Rating tie breakers
            score += (p.rating_avg || 0) + (p.total_sold_quantity || 0) * 0.001;

            return { product: p, score };
          });

          // Sort descending by score
          scoredCatProducts.sort((a, b) => b.score - a.score);

          // Keep the best representative for this category
          if (scoredCatProducts.length > 0) {
            categoryRepresentatives.push({
              product: scoredCatProducts[0].product,
              score: scoredCatProducts[0].score
            });
          }
        }

        // Sort the representatives by score descending
        categoryRepresentatives.sort((a, b) => b.score - a.score);

        // Take the top 4 representatives (guarantees up to 4 different categories are shown, prioritizing the most relevant ones)
        this.products = categoryRepresentatives.slice(0, 4).map(r => r.product);
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
    this.stopAlarm();
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
    if (this.isAlarming) {
      this.stopAlarm();
    } else if (this.timerRunning) {
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
    this.stopAlarm();
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
    this.startAlarmSound();
    this.cdr.detectChanges();
  }

  startAlarmSound(): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        this.isAlarming = true;
        this.alarmAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Ring immediately
        this.playAlarmBeep();
        
        // Loop every 1 second
        this.alarmInterval = setInterval(() => {
          this.playAlarmBeep();
        }, 1000);
      } catch (e) {
        console.warn('Failed to start alarm sound:', e);
      }
    }
  }

  private playAlarmBeep(): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        if (!this.alarmAudioCtx || this.alarmAudioCtx.state === 'suspended') {
          this.alarmAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const osc = this.alarmAudioCtx.createOscillator();
        const gain = this.alarmAudioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(this.alarmAudioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, this.alarmAudioCtx.currentTime);
        
        // Double beep pattern: beep-beep
        gain.gain.setValueAtTime(0.4, this.alarmAudioCtx.currentTime);
        gain.gain.setValueAtTime(0.01, this.alarmAudioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, this.alarmAudioCtx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.01, this.alarmAudioCtx.currentTime + 0.4);
        
        osc.start();
        osc.stop(this.alarmAudioCtx.currentTime + 0.5);
      } catch (e) {
        console.warn('Alarm beep step failed:', e);
      }
    }
  }

  stopAlarm(): void {
    this.isAlarming = false;
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.alarmAudioCtx) {
      try {
        this.alarmAudioCtx.close();
      } catch (e) {}
      this.alarmAudioCtx = null;
    }
    this.timeLeft = this.timerDuration;
    this.cdr.detectChanges();
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
    const teaKeywords = ['matcha', 'hojicha', 'sencha', 'genmaicha', 'tea', 'green tea'];
    const hasMatcha = teaKeywords.some(kw => titleLower.includes(kw)) || 
                      recipe.metadata.tags.some((t: string) => teaKeywords.includes(t.toLowerCase()));
    if (hasMatcha) return 'Matcha';
    const hasCoffee = titleLower.includes('coffee') || recipe.metadata.tags.some((t: string) => t.toLowerCase() === 'coffee');
    if (hasCoffee) return 'Coffee';
    return 'Others';
  }

  getViewAllShopLink(): string {
    if (!this.recipe) return '/shop/matcha';
    const base = this.getRecipeBaseLabel(this.recipe);
    if (base === 'Coffee') {
      return '/shop/coffee';
    }
    return '/shop/matcha';
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
          this.savedRecipeIds.add(recipe.recipe_id);
          recipe.saves += 1;
        } else {
          this.savedRecipeIds.delete(recipe.recipe_id);
          recipe.saves = Math.max(0, recipe.saves - 1);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to toggle favorite detail:', err);
      }
    });
  }

  isFavorited(recipe: Recipe): boolean {
    return this.savedRecipeIds.has(recipe.recipe_id);
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

  isProductSaved(product: Product): boolean {
    return this.savedProductIds.has(product.product_id);
  }

  async onSaveProduct(product: Product): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(product.product_id);
      if (result.saved) this.savedProductIds.add(product.product_id);
      else this.savedProductIds.delete(product.product_id);
      this.cdr.detectChanges();
    } catch (err) {
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
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to load saved products:', err);
    }
  }

  private location = inject(Location);

  goBack(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (this.shouldBackToRecipesIndex()) {
        void this.router.navigate(['/recipes']);
        return;
      }

      if (window.history.length > 1) {
        this.location.back();
      } else {
        void this.router.navigate(['/recipes']);
      }
    }
  }

  private shouldBackToRecipesIndex(): boolean {
    const navigationState = this.router.getCurrentNavigation()?.extras.state;
    const currentState = window.history.state;

    return this.isRecipesIndexEntrySource(navigationState?.['contentEntrySource'])
      || this.isRecipesIndexEntrySource(currentState?.['contentEntrySource']);
  }

  private isRecipesIndexEntrySource(source: unknown): boolean {
    return source === 'product-detail' || source === 'homepage';
  }
}
