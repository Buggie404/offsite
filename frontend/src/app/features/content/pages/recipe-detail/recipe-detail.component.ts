import { Component, OnInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef, HostListener, effect, TransferState, makeStateKey } from '@angular/core';
import { CommonModule, isPlatformBrowser, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { 
  LucideArrowLeft, 
  LucideClock, 
  LucideStar, 
  LucideHeart, 
  LucideDroplet, 
  LucidePlay,
  LucideEllipsis,
  LucideCheck,
  LucideUser,
  LucideLink,
  LucideShare2
} from '@lucide/angular';
import { ContentService } from '../../services/content.service';
import { ProductService } from '../../../home/services/product.service';
import { Recipe } from '../../../../shared/models/recipe.model';
import { Product, getDefaultPrice, isProductOutOfStock } from '../../../home/models/product.model';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';
import { ProductCardComponent } from '../../../shop/components/product-card/product-card.component';
import { DragScrollDirective } from '../../../../shared/directives/drag-scroll.directive';
import { ShareModalComponent } from '../../../community/components/share-modal/share-modal.component';
import { BrewCoachComponent } from '../../components/brew-coach/brew-coach.component';
import { clearBrewProgress, readBrewProgress, resumeSecondsLeft } from '../../components/brew-coach/brew-progress';
import { BrewPrepItem, BrewPrepModalComponent } from '../../components/brew-prep-modal/brew-prep-modal.component';
import { BrewResumeModalComponent } from '../../components/brew-resume-modal/brew-resume-modal.component';
import { PantryCoverage, PantryCoverageRow } from '../../../account/components/my-pantry/pantry.model';
import { PantryService } from '../../../account/components/my-pantry/pantry.service';

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
    LucidePlay,
    LucideEllipsis,
    LucideCheck,
    LucideUser,
    LucideLink,
    LucideShare2,
    BackToTopComponent,
    ProductCardComponent,
    DragScrollDirective,
    ShareModalComponent,
    BrewCoachComponent,
    BrewPrepModalComponent,
    BrewResumeModalComponent
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
  private authModal = inject(AuthModalService);
  private authPromptService = inject(AuthPromptModalService);
  private http = inject(HttpClient);
  private transferState = inject(TransferState);
  private pantry = inject(PantryService);
  private destroy$ = new Subject<void>();
  private pendingMarkDone = false;
  private markDoneWrites = 0;
  private markDoneRevision = 0;
  private pendingFavoriteId: string | null = null;
  private pendingProductId: number | null = null;
  private savedRecipesKnown = false;
  private savedRecipesLoading = false;
  private savedProductsLoaded = false;
  private savedProductsRequest: Promise<void> | null = null;
  private wasAuthed = false;
  private needsSaveSync = false;

  constructor() {
    this.wasAuthed = this.authService.isAuthenticated();
    effect(() => {
      const authed = this.authService.isAuthenticated();
      const promptOpen = this.authPromptService.isOpen();
      const modalOpen = this.authModal.isOpen();
      const successOpen = this.authModal.successOpen();
      const authUiOpen = promptOpen || modalOpen || successOpen;
      const authDismissed = !authed && !authUiOpen && !this.authPromptService.shouldStayOnPage();
      const loggedOut = this.wasAuthed && !authed;
      const loggedIn = !this.wasAuthed && authed;
      this.wasAuthed = authed;

      if (loggedOut) this.clearUserState();
      if (loggedIn) this.needsSaveSync = true;

      if (loggedIn && this.recipe?.recipe_id) this.loadPantryCoverage(this.recipe.recipe_id);

      if (!authed) {
        if (authDismissed) this.dropPendingActions();
        return;
      }
      if (authUiOpen) return;

      if (this.pendingMarkDone && this.recipe?.recipe_id) {
        this.pendingMarkDone = false;
        this.authPromptService.clearResume('mark-done');
        this.persistMarkedDone(true);
      }

      const favoriteId = this.pendingFavoriteId;
      if (favoriteId) {
        this.pendingFavoriteId = null;
        this.authPromptService.clearResume('save-recipe');
        this.persistFavorite(favoriteId);
      }

      const productId = this.pendingProductId;
      if (productId != null) {
        this.pendingProductId = null;
        this.authPromptService.clearResume('save-product');
        void this.persistSavedProduct(productId);
      }

      if (!this.needsSaveSync) return;
      this.needsSaveSync = false;
      if (!favoriteId) this.fetchSavedRecipes();
      if (productId == null) void this.loadSavedProducts();
    });
  }

  recipe: Recipe | null = null;
  relatedRecipes: Recipe[] = [];
  savedRecipeIds = new Set<string>();
  savedProductIds = new Set<number>();
  products: Product[] = [];
  private catalogProducts: Product[] = [];
  isLoading = true;
  errorMessage = '';
  markedDone = false;
  moreMenuOpen = false;
  linkCopied = false;
  shareOpen = false;
  shareUrl = '';
  brewCoachOpen = false;
  prepModalOpen = false;
  resumeModalOpen = false;
  resumeStep = 1;
  resumeSeconds: number | null = null;
  checkedItemKeys = new Set<string>();
  pantryCoverage: PantryCoverage | null = null;
  private dismissedChecks = new Set<string>();
  private prepPantrySelection = new Map<string, string>();
  private coverageRevision = 0;
  private flagsRequest = 0;
  private stashedFlags: { request: number; revision: number; res: any } | null = null;
  private recipeFlags: { saved_recipes: any[]; done_recipes: any[] } | null = null;
  private flagFavoriteId: string | null = null;
  private flagProductId: number | null = null;

  @HostListener('document:click')
  onDocumentClick(): void {
    if (!this.moreMenuOpen) return;
    this.moreMenuOpen = false;
    this.linkCopied = false;
  }

  // Swatches for Coffee Roast level
  roastSwatches = [
    '#f3f8ec', '#e5f1d5', '#d7eabf', '#c9e3a9', '#b5d48a',
    '#96bf62', '#74a340', '#567d2e', '#43631f', '#375534'
  ];

  private loadedSlug: string | null = null;

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const slug = params['slug'];
      if (slug && slug !== this.loadedSlug) {
        this.loadedSlug = slug;
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
  }

  loadRecipeDetail(slug: string): void {
    const requestedBrew = isPlatformBrowser(this.platformId)
      ? new URL(window.location.href).searchParams.get('brew')
      : null;
    const stateKey = makeStateKey<Recipe>(`recipe-detail:${slug}`);
    const transferred = this.transferState.get<Recipe | null>(stateKey, null);

    this.errorMessage = '';
    this.markedDone = false;
    this.moreMenuOpen = false;
    this.linkCopied = false;
    this.checkedItemKeys = new Set<string>();
    this.dismissedChecks = new Set<string>();
    this.pantryCoverage = null;
    this.coverageRevision += 1;
    this.shareOpen = false;
    this.brewCoachOpen = false;
    this.prepModalOpen = false;
    this.resumeModalOpen = false;
    this.flagFavoriteId = null;
    this.flagProductId = null;
    this.stashedFlags = null;
    if (isPlatformBrowser(this.platformId) && this.hasAccessToken() && !this.recipeFlags) {
      this.requestRecipeFlags();
    }

    if (transferred) {
      this.transferState.remove(stateKey);
      this.finishRecipeLoad(transferred, requestedBrew);
      return;
    }

    this.recipe = null;
    this.isLoading = true;
    this.reveal();

    this.contentService.getRecipe(slug).pipe(takeUntil(this.destroy$)).subscribe({
      next: (recipe) => {
        if (!isPlatformBrowser(this.platformId)) {
          this.transferState.set(stateKey, recipe);
        }
        this.finishRecipeLoad(recipe, requestedBrew);
      },
      error: (err) => {
        console.error('Error loading recipe:', err);
        if (err?.status === 404) {
          void this.router.navigateByUrl('/404', { skipLocationChange: true });
          return;
        }
        this.errorMessage = 'Failed to load recipe detail. Please try again.';
        this.isLoading = false;
        this.reveal();
      }
    });
  }

  private finishRecipeLoad(recipe: Recipe, requestedBrew: string | null): void {
    this.recipe = recipe;
    const favoriteId = this.pullFavoriteResume(recipe);
    const productId = this.pullProductResume(recipe);
    this.applyAuthResume(recipe);
    this.isLoading = false;
    this.openRequestedBrew(requestedBrew);
    this.reveal();

    if (!isPlatformBrowser(this.platformId)) return;

    this.loadProducts(recipe.relatedProducts || []);
    this.loadRelatedRecipes(recipe._id);
    this.flagFavoriteId = favoriteId;
    this.flagProductId = productId;

    if (!this.hasAccessToken()) return;

    this.loadPantryCoverage(recipe.recipe_id);
    if (this.recipeFlags) {
      this.applyRecipeFlags(this.recipeFlags, this.markDoneRevision);
      return;
    }
    const stashed = this.stashedFlags;
    if (stashed && stashed.request === this.flagsRequest) {
      this.stashedFlags = null;
      this.applyRecipeFlags(stashed.res, stashed.revision);
    }
  }

  private reveal(): void {
    this.cdr.markForCheck();
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => this.cdr.markForCheck());
  }

  loadProducts(relatedProductIds: string[]): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.productService.getProducts().pipe(takeUntil(this.destroy$)).subscribe({
      next: (allProducts) => {
        this.catalogProducts = allProducts;
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

          // Keep a few representatives per category so the row can scroll
          categoryRepresentatives.push(...scoredCatProducts.slice(0, 3));
        }

        categoryRepresentatives.sort((a, b) => b.score - a.score);
        this.products = categoryRepresentatives.slice(0, 12).map(r => r.product);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading products:', err);
      }
    });
  }

  loadRelatedRecipes(excludeId: string): void {
    if (!isPlatformBrowser(this.platformId) || !this.recipe) return;
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

        this.relatedRecipes = scored.map(s => s.recipe).slice(0, 12);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading related recipes:', err);
      }
    });
  }

  toggleItem(key: string): void {
    if (this.checkedItemKeys.has(key)) {
      this.checkedItemKeys.delete(key);
      this.dismissedChecks.add(key);
    } else {
      this.dismissedChecks.delete(key);
      this.checkedItemKeys.add(key);
    }
  }

  isItemChecked(key: string): boolean {
    return this.checkedItemKeys.has(key);
  }

  pantryRow(name: string): PantryCoverageRow | null {
    const row = this.ingredientCoverage(name) || this.toolCoverage(name);
    return row?.covered ? row : null;
  }

  private ingredientCoverage(name: string): PantryCoverageRow | null {
    const key = this.pantryKey(name);
    if (!key) return null;
    return (this.pantryCoverage?.ingredients || []).find(row => this.pantryKey(row.name) === key) || null;
  }

  private toolCoverage(name: string): PantryCoverageRow | null {
    const key = this.pantryKey(name);
    if (!key) return null;
    return (this.pantryCoverage?.tools || []).find(row => this.pantryKey(row.name) === key) || null;
  }

  private prepToolChoice(name: string): Pick<BrewPrepItem, 'pantryLabel' | 'deductLabel' | 'candidates' | 'selectedId'> {
    const row = this.toolCoverage(name);
    const empty = { pantryLabel: '', deductLabel: '', candidates: [], selectedId: '' };
    if (!row?.covered) return empty;
    const listed = (row.candidates || []).filter(item => item.id);
    const picked = listed[0];
    if (!picked) {
      return { pantryLabel: 'In your pantry', deductLabel: '', candidates: [{ id: 'in-pantry', label: 'In your pantry' }], selectedId: 'in-pantry' };
    }
    return {
      pantryLabel: 'In your pantry',
      deductLabel: '',
      candidates: [{ id: picked.id, label: picked.name }],
      selectedId: picked.id,
    };
  }

  private prepPantryChoice(name: string): Pick<BrewPrepItem, 'pantryLabel' | 'deductLabel' | 'candidates' | 'selectedId'> {
    const row = this.ingredientCoverage(name);
    const usable = !!row && !row.staple && row.drawQuantity != null && row.drawQuantity > 0;
    const candidates = usable && row ? row.candidates || [] : [];
    const selectedId = this.selectedPrepId(name, candidates);
    const selected = candidates.find(item => item.id === selectedId);
    return {
      pantryLabel: selected?.name || '',
      deductLabel: usable ? this.coverageDeductLabel(row) : '',
      candidates: candidates.map(item => ({
        id: item.id,
        label: item.quantity == null ? item.name : `${item.name} · ${this.formatItemAmount(item.quantity, item.unit)}`,
      })),
      selectedId,
    };
  }

  private selectedPrepId(name: string, candidates: { id: string }[]): string {
    const saved = this.prepPantrySelection.get(this.pantryKey(name));
    if (saved && candidates.some(item => item.id === saved)) return saved;
    return candidates[0]?.id || '';
  }

  private coverageDeductLabel(row: PantryCoverageRow | null): string {
    if (!row || row.drawQuantity == null || row.drawQuantity <= 0 || !row.drawUnit) return '';
    return `Uses ${this.formatItemAmount(row.drawQuantity, row.drawUnit)}`;
  }

  isInPantry(name: string): boolean {
    return !!this.pantryRow(name);
  }

  displayAmount(ingredient: { name: string; quantity?: number; unit?: string }): string {
    const row = this.pantryRow(ingredient.name);
    if (row && row.quantity != null && !row.staple) {
      return this.formatItemAmount(row.quantity, row.unit || ingredient.unit);
    }
    return this.formatItemAmount(ingredient.quantity, ingredient.unit);
  }

  formatItemAmount(quantity?: number, unit?: string): string {
    const normalized = (unit || '').trim();
    if (quantity == null) return normalized;
    const compactUnits = ['g', 'kg', 'ml', 'l', 'oz', 'lb'];
    if (!normalized) return `${quantity}`;
    if (compactUnits.includes(normalized.toLowerCase())) return `${quantity}${normalized}`;
    return `${quantity} ${normalized}`;
  }

  toggleMarkedDone(): void {
    if (!this.recipe || this.markedDone) return;
    if (!this.authService.isAuthenticated()) {
      this.pendingMarkDone = true;
      const recipeKey = this.recipe.slug || this.recipe.recipe_id || this.recipe._id;
      if (recipeKey) {
        this.authPromptService.arm({ action: 'mark-done', slug: recipeKey });
      }
      this.authPromptService.open();
      return;
    }
    this.persistMarkedDone(true);
  }

  private persistMarkedDone(isDone: boolean): void {
    const recipe = this.recipe;
    const recipeId = recipe?.recipe_id;
    if (!recipe || !recipeId) return;

    const previous = this.markedDone;
    const request = ++this.markDoneRevision;
    this.markedDone = isDone;
    this.markDoneWrites += 1;
    this.cdr.markForCheck();

    this.http.patch<any>(`/api/auth/done-recipes/${encodeURIComponent(recipeId)}`, { is_done: isDone }).subscribe({
      next: (res) => {
        this.markDoneWrites = Math.max(0, this.markDoneWrites - 1);
        if (request !== this.markDoneRevision) return;
        if (!this.authService.isAuthenticated() || this.recipe?.recipe_id !== recipeId) return;
        if (res?.done_recipe?.is_done) this.markedDone = true;
        this.markDoneRevision += 1;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.markDoneWrites = Math.max(0, this.markDoneWrites - 1);
        console.error('Failed to update recipe done state:', err);
        if (request !== this.markDoneRevision) return;
        if (!this.authService.isAuthenticated() || this.recipe?.recipe_id !== recipeId) return;
        this.markedDone = previous;
        this.cdr.markForCheck();
      }
    });
  }

  onBrewSaved(coverage?: PantryCoverage | null): void {
    if (!this.hasAccessToken()) return;
    this.markedDone = true;
    const recipeId = this.recipe?.recipe_id;
    if (coverage && recipeId && coverage.recipeId === recipeId) {
      this.coverageRevision += 1;
      this.pantryCoverage = coverage;
      this.seedPantryChecks();
      this.pantry.applyBrewResult(recipeId, coverage);
      this.cdr.markForCheck();
      return;
    }
    this.cdr.markForCheck();
    if (this.authService.isAuthenticated() && recipeId) {
      this.persistMarkedDone(true);
      this.loadPantryCoverage(recipeId);
    }
  }

  private clearUserState(): void {
    this.savedRecipeIds = new Set();
    this.savedProductIds = new Set();
    this.savedRecipesKnown = false;
    this.savedRecipesLoading = false;
    this.savedProductsLoaded = false;
    this.savedProductsRequest = null;
    this.markedDone = false;
    this.pendingMarkDone = false;
    this.pendingFavoriteId = null;
    this.pendingProductId = null;
    this.needsSaveSync = false;
    this.checkedItemKeys = new Set<string>();
    this.dismissedChecks = new Set<string>();
    this.prepPantrySelection = new Map<string, string>();
    this.pantryCoverage = null;
    this.coverageRevision += 1;
    this.recipeFlags = null;
    this.stashedFlags = null;
    this.flagsRequest += 1;
    this.flagFavoriteId = null;
    this.flagProductId = null;
    this.cdr.markForCheck();
  }

  private dropPendingActions(): void {
    if (this.pendingMarkDone) {
      this.pendingMarkDone = false;
      this.authPromptService.clearResume('mark-done');
    }
    if (this.pendingFavoriteId) {
      this.pendingFavoriteId = null;
      this.authPromptService.clearResume('save-recipe');
    }
    if (this.pendingProductId != null) {
      this.pendingProductId = null;
      this.authPromptService.clearResume('save-product');
    }
  }

  private applyAuthResume(recipe: Recipe): void {
    if (!this.authService.isAuthenticated()) return;
    const resume = this.authPromptService.peek();
    if (!resume || !this.recipeKeys(recipe).includes(resume.slug)) return;
    if (resume.action === 'mark-done') {
      this.pendingMarkDone = false;
      this.authPromptService.clearResume('mark-done');
      this.persistMarkedDone(true);
      return;
    }
    if (resume.action === 'save-brew') {
      this.brewCoachOpen = true;
    }
  }

  private pullFavoriteResume(recipe: Recipe): string | null {
    if (!this.authService.isAuthenticated()) return null;
    const resume = this.authPromptService.peek();
    if (!resume || resume.action !== 'save-recipe' || !resume.recipeId) return null;
    if (!this.recipeKeys(recipe).includes(resume.slug)) return null;
    this.authPromptService.clearResume('save-recipe');
    return resume.recipeId;
  }

  private pullProductResume(recipe: Recipe): number | null {
    if (!this.authService.isAuthenticated()) return null;
    const resume = this.authPromptService.peek();
    if (!resume || resume.action !== 'save-product' || resume.productId == null) return null;
    if (!this.recipeKeys(recipe).includes(resume.slug)) return null;
    this.authPromptService.clearResume('save-product');
    return resume.productId;
  }

  private hasAccessToken(): boolean {
    return isPlatformBrowser(this.platformId) && !!localStorage.getItem('token');
  }

  private requestRecipeFlags(): void {
    if (!this.hasAccessToken() || this.savedRecipesKnown || this.savedRecipesLoading) return;
    const request = ++this.flagsRequest;
    const revision = this.markDoneRevision;
    this.savedRecipesLoading = true;
    this.http.get<any>('/api/auth/recipe-flags').subscribe({
      next: (res) => {
        this.savedRecipesLoading = false;
        if (request !== this.flagsRequest || !this.hasAccessToken()) return;
        if (!this.recipe) {
          this.stashedFlags = { request, revision, res };
          return;
        }
        this.applyRecipeFlags(res, revision);
      },
      error: (err) => {
        this.savedRecipesLoading = false;
        if (request !== this.flagsRequest) return;
        console.error('Failed to fetch recipe flags:', err);
        const favoriteId = this.flagFavoriteId;
        const productId = this.flagProductId;
        this.flagFavoriteId = null;
        this.flagProductId = null;
        if (favoriteId) this.persistFavorite(favoriteId);
        if (productId != null) void this.persistSavedProduct(productId);
      }
    });
  }

  private applyRecipeFlags(res: { saved_recipes?: any[]; done_recipes?: any[] }, revision: number): void {
    const saved = res?.saved_recipes || [];
    const done = res?.done_recipes || [];
    this.recipeFlags = { saved_recipes: saved, done_recipes: done };
    this.rememberSavedRecipes(saved, revision);
    this.applyDoneRecipes(done, saved, revision);
    const favoriteId = this.flagFavoriteId;
    const productId = this.flagProductId;
    this.flagFavoriteId = null;
    this.flagProductId = null;
    if (favoriteId && !this.savedRecipeIds.has(favoriteId)) this.persistFavorite(favoriteId);
    if (productId != null) void this.persistSavedProduct(productId);
    this.reveal();
  }

  private rememberSavedRecipes(items: any[], revision = this.markDoneRevision): void {
    const ids = new Set<string>((items || []).map((sr: any) => sr?.recipe?.recipe_id || sr?.recipe_id).filter(Boolean));
    if (revision !== this.markDoneRevision) {
      ids.forEach(id => this.savedRecipeIds.add(id));
      if (this.recipe) {
        (this.recipe as any).isFavorited = this.savedRecipeIds.has(this.recipe.recipe_id);
      }
      return;
    }

    this.savedRecipeIds = ids;
    this.savedRecipesKnown = true;
    if (this.recipe) {
      (this.recipe as any).isFavorited = this.savedRecipeIds.has(this.recipe.recipe_id);
    }
  }

  private applyDoneRecipes(items: any[], savedItems: any[] = [], revision = this.markDoneRevision): void {
    if (revision !== this.markDoneRevision || this.markDoneWrites > 0 || this.pendingMarkDone || !this.recipe) return;
    const recipeId = this.recipe.recipe_id;
    const mine = (items || []).find((item: any) => item?.recipe_id === recipeId);
    const saved = (savedItems || []).find((item: any) => (item?.recipe?.recipe_id || item?.recipe_id) === recipeId);
    if (!mine?.is_done && !saved?.is_done) return;
    this.markedDone = true;
    if (saved?.is_done && !mine?.is_done) this.persistMarkedDone(true);
  }

  private fetchSavedRecipes(): void {
    if (!this.hasAccessToken()) return;
    this.requestRecipeFlags();
  }

  private recipeKeys(recipe: Recipe): string[] {
    return [recipe.slug, recipe.recipe_id, recipe._id].filter((key): key is string => !!key);
  }

  private persistFavorite(recipeId: string): void {
    if (!recipeId) return;
    if (!this.savedRecipesKnown) {
      const savedRevision = this.markDoneRevision;
      this.http.get<any>('/api/auth/recipe-flags').subscribe({
        next: (res) => {
          if (!this.hasAccessToken()) return;
          this.rememberSavedRecipes(res.saved_recipes || [], savedRevision);
          this.applyDoneRecipes(res.done_recipes || [], res.saved_recipes || [], savedRevision);
          if (this.savedRecipeIds.has(recipeId)) {
            this.cdr.markForCheck();
            return;
          }
          this.postFavorite(recipeId);
        },
        error: (err) => {
          console.error('Failed to fetch saved recipes before like:', err);
          this.postFavorite(recipeId);
        }
      });
      return;
    }
    if (this.savedRecipeIds.has(recipeId)) return;
    this.postFavorite(recipeId);
  }

  private postFavorite(recipeId: string): void {
    if (this.savedRecipeIds.has(recipeId)) return;
    this.savedRecipeIds = new Set([...this.savedRecipeIds, recipeId]);
    const target = this.findRecipe(recipeId);
    if (target) target.saves += 1;
    this.cdr.markForCheck();

    this.http.post<any>('/api/auth/saved-recipes', { recipeId }).subscribe({
      next: (res) => {
        if (!this.authService.isAuthenticated()) return;
        if (res.saved) return;
        const next = new Set(this.savedRecipeIds);
        next.delete(recipeId);
        this.savedRecipeIds = next;
        if (target) target.saves = Math.max(0, target.saves - 1);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to save recipe after login:', err);
        if (!this.authService.isAuthenticated()) return;
        const next = new Set(this.savedRecipeIds);
        next.delete(recipeId);
        this.savedRecipeIds = next;
        if (target) target.saves = Math.max(0, target.saves - 1);
        this.cdr.markForCheck();
      }
    });
  }

  private findRecipe(recipeId: string): Recipe | null {
    if (this.recipe?.recipe_id === recipeId) return this.recipe;
    return this.relatedRecipes.find(recipe => recipe.recipe_id === recipeId) ?? null;
  }

  toggleMoreMenu(event: Event): void {
    event.stopPropagation();
    this.moreMenuOpen = !this.moreMenuOpen;
    if (!this.moreMenuOpen) this.linkCopied = false;
  }

  copyRecipeLink(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const url = window.location.href;
    const finish = () => {
      this.linkCopied = true;
      this.cdr.markForCheck();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(finish).catch(finish);
      return;
    }
    finish();
  }

  openShare(): void {
    if (!isPlatformBrowser(this.platformId) || !this.recipe) return;
    this.moreMenuOpen = false;
    this.linkCopied = false;
    this.shareUrl = window.location.href;
    this.shareOpen = true;
  }

  getAuthorName(recipe: Recipe): string {
    return recipe.source.author || recipe.source.creatorName || 'Offsite';
  }

  getAuthorInitials(recipe: Recipe): string {
    const name = this.getAuthorName(recipe).replace(/^@/, '');
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  getServeStyleLabel(recipe: Recipe): string {
    const map: Record<string, string> = {
      HOT: 'Hot',
      COLD: 'Iced',
      DESSERT: 'Dessert',
      COCKTAIL: 'Cocktail',
    };
    const badge = this.getBadgeLabel(recipe);
    return map[badge] || 'Standard';
  }

  get prepItems(): BrewPrepItem[] {
    if (!this.recipe) return [];

    const ingredients = this.recipe.ingredients.map((ingredient, index) => {
      const coverage = this.ingredientCoverage(ingredient.name);
      const adjusted = coverage?.quantity != null;
      return {
        key: `ing-${index}`,
        name: ingredient.name,
        optional: ingredient.optional,
        amount: this.formatItemAmount(
          adjusted ? coverage?.quantity ?? undefined : ingredient.quantity,
          adjusted ? coverage?.unit : ingredient.unit
        ),
        checked: this.isItemChecked(`ing-${index}`),
        ...this.prepPantryChoice(ingredient.name),
      };
    });

    const tools = this.recipe.tools.map((tool, index) => ({
      key: `tool-${index}`,
      name: tool.name,
      optional: false,
      amount: '',
      checked: this.isItemChecked(`tool-${index}`),
      ...this.prepToolChoice(tool.name),
    }));

    return [...ingredients, ...tools];
  }

  get brewPantrySelections(): { ingredient_name: string; pantry_item_id: string }[] {
    return this.prepItems
      .filter(item => item.key.startsWith('ing-') && item.selectedId && item.selectedId !== 'in-pantry')
      .map(item => ({ ingredient_name: item.name, pantry_item_id: item.selectedId }));
  }

  selectPrepPantry(event: { name: string; id: string }): void {
    const key = this.pantryKey(event.name);
    if (!key || !event.id) return;
    this.prepPantrySelection.set(key, event.id);
  }

  startBrewing(): void {
    if (!isPlatformBrowser(this.platformId) || !this.recipe) return;
    const progress = readBrewProgress(this.brewStorageKey());
    if (progress) {
      this.resumeStep = progress.stepIndex + 1;
      this.resumeSeconds = resumeSecondsLeft(this.recipe, progress);
      this.resumeModalOpen = true;
      this.reveal();
      return;
    }
    this.seedPantryChecks();
    this.prepModalOpen = true;
    this.reveal();
  }

  continueResume(): void {
    this.resumeModalOpen = false;
    this.brewCoachOpen = true;
    this.rememberBrewStart();
    this.reveal();
  }

  restartResume(): void {
    clearBrewProgress(this.brewStorageKey());
    this.resumeModalOpen = false;
    this.seedPantryChecks();
    this.prepModalOpen = true;
    this.reveal();
  }

  private brewStorageKey(): string {
    if (!this.recipe) return '';
    return this.recipe.recipe_id || this.recipe._id || this.recipe.slug;
  }

  private openRequestedBrew(requested?: string | null): void {
    if (!isPlatformBrowser(this.platformId) || !this.recipe) return;
    const brew = requested === 'start' || requested === 'resume'
      ? requested
      : this.route.snapshot.queryParamMap.get('brew');
    if (brew !== 'start' && brew !== 'resume') return;
    if (brew === 'resume') {
      this.brewCoachOpen = true;
      this.rememberBrewStart();
    } else {
      this.seedPantryChecks();
      this.prepModalOpen = true;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('brew');
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', next);
  }

  confirmStartBrewing(): void {
    this.prepModalOpen = false;
    this.brewCoachOpen = true;
    this.rememberBrewStart();
  }

  private rememberBrewStart(): void {
    const recipeId = this.recipe?.recipe_id;
    if (!recipeId) return;
    this.pantry.recordBrewStart(recipeId);
  }

  private seedPantryChecks(): void {
    if (!this.recipe) return;

    this.recipe.ingredients.forEach((ingredient, index) => {
      const key = `ing-${index}`;
      if (this.dismissedChecks.has(key)) return;
      if (this.isInPantry(ingredient.name)) this.checkedItemKeys.add(key);
    });
    this.recipe.tools.forEach((tool, index) => {
      const key = `tool-${index}`;
      if (this.dismissedChecks.has(key)) return;
      if (this.isInPantry(tool.name)) this.checkedItemKeys.add(key);
    });
  }

  private loadPantryCoverage(recipeId: string): void {
    if (!recipeId || !this.hasAccessToken()) {
      this.pantryCoverage = null;
      return;
    }
    const request = ++this.coverageRevision;
    void this.pantry.coverage(recipeId).then(coverage => {
      if (request !== this.coverageRevision || this.recipe?.recipe_id !== recipeId || !this.hasAccessToken()) return;
      this.pantryCoverage = coverage;
      this.seedPantryChecks();
      this.reveal();
    }).catch(() => undefined);
  }

  private pantryKey(name: string): string {
    return String(name || '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
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
      const page = this.recipe;
      const pageKey = page ? (page.slug || page.recipe_id || page._id) : recipe.recipe_id;
      if (pageKey && recipe.recipe_id) {
        this.pendingFavoriteId = recipe.recipe_id;
        this.authPromptService.arm({ action: 'save-recipe', slug: pageKey, recipeId: recipe.recipe_id });
      }
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
        this.cdr.markForCheck();
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
      const page = this.recipe;
      const pageKey = page ? (page.slug || page.recipe_id || page._id) : '';
      if (pageKey) {
        this.pendingProductId = product.product_id;
        this.authPromptService.arm({ action: 'save-product', slug: pageKey, productId: product.product_id });
      }
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedProduct(product.product_id);
      if (result.saved) this.savedProductIds.add(product.product_id);
      else this.savedProductIds.delete(product.product_id);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  }

  private loadSavedProducts(): Promise<void> {
    if (!this.authService.isAuthenticated() || this.savedProductsLoaded) return Promise.resolve();
    if (this.savedProductsRequest) return this.savedProductsRequest;

    this.savedProductsRequest = (async () => {
      try {
        const result = await this.authService.getSavedItems();
        if (!this.authService.isAuthenticated()) return;
        this.savedProductIds = new Set(
          (result.saved_products || [])
            .map((item: any) => Number(item.product?.product_id ?? item.product_id))
            .filter((id: number) => !Number.isNaN(id))
        );
        this.savedProductsLoaded = true;
        this.cdr.markForCheck();
      } catch (err) {
        console.error('Failed to load saved products:', err);
      } finally {
        this.savedProductsRequest = null;
      }
    })();

    return this.savedProductsRequest;
  }

  private async persistSavedProduct(productId: number): Promise<void> {
    if (!this.authService.isAuthenticated()) return;
    await this.loadSavedProducts();
    if (!this.authService.isAuthenticated() || !this.savedProductsLoaded || this.savedProductIds.has(productId)) return;

    try {
      const result = await this.authService.toggleSavedProduct(productId);
      if (!this.authService.isAuthenticated()) return;
      if (result.saved) this.savedProductIds.add(productId);
      else this.savedProductIds.delete(productId);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to save product after login:', err);
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
