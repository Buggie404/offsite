import { AfterViewInit, Component, OnDestroy, OnInit, PLATFORM_ID, effect, signal, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationStart, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { CollectionComponent } from '../components/collection/collection.component';
import { BestSellerComponent } from '../components/best-seller/best-seller.component';
import { RecipeSectionComponent } from '../components/recipes/recipe-section.component';
import { HeroComponent } from '../components/hero-banner/hero.component';
import { PromoTickerComponent } from '../components/promo-ticker/promo-ticker.component';
import { BrandStoryComponent } from '../components/brand-story/brand-story.component';
import { CommunityComponent } from '../components/community/community.component';
import { BackToTopComponent } from '../../../shared/components/back-to-top/back-to-top.component';

import { RitualWelcomeComponent, HomeRitualProfile } from '../components/ritual-welcome/ritual-welcome.component';
import { AuthService } from '../../../core/auth.service';
import { HttpService } from '../../../core/http.service';
import { ProductService } from '../services/product.service';
import { RecipeService } from '../services/recipe.service';
import { Product, isProductOutOfStock } from '../models/product.model';
import { Recipe } from '../models/recipe.model';

interface HomePicks {
  products: Array<{ id: string; fit_percent?: number }>;
  recipes: Array<{ id: string; slug: string }>;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    RitualWelcomeComponent,
    CollectionComponent,
    BestSellerComponent,
    RecipeSectionComponent,
    HeroComponent,
    PromoTickerComponent,
    BrandStoryComponent,
    CommunityComponent,
    BackToTopComponent
    // thêm vào đây
  ],
  templateUrl: './home.component.html',   // ← đổi từ template sang templateUrl
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private routerEventsSubscription?: Subscription;
  private scrollRestoreTimers: Array<ReturnType<typeof setTimeout>> = [];
  private savedScrollY: number | null = null;

  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpService);
  private readonly productsApi = inject(ProductService);
  private readonly recipesApi = inject(RecipeService);
  private personalizationRevision = 0;
  private personalizationUser: string | null | undefined;
  readonly ritualProfileLoading = signal(false);
  readonly ritualProfile = signal<HomeRitualProfile | null>(null);
  readonly ritualProducts = signal<Product[]>([]);
  readonly ritualRecipes = signal<Recipe[]>([]);
  readonly ritualFits = signal<Record<number, { percent: number; name: string; archetypeId: string }>>({});

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const key = this.auth.isAuthenticated() ? String(user?.user_id || user?._id || 'signed-in') : null;
      if (!isPlatformBrowser(this.platformId) || key === this.personalizationUser) return;
      this.personalizationUser = key;
      const revision = ++this.personalizationRevision;
      this.ritualProfileLoading.set(Boolean(key));
      this.ritualProfile.set(null);
      this.ritualProducts.set([]);
      this.ritualRecipes.set([]);
      this.ritualFits.set({});
      if (key) void this.loadRitualPicks(revision);
    });
  }

  private async loadRitualPicks(revision: number): Promise<void> {
    try {
      const response = await this.http.get('/ritual-dna/me') as { result: HomeRitualProfile | null };
      if (revision !== this.personalizationRevision) return;
      this.ritualProfileLoading.set(false);
      if (!response.result) return;
      const profile = response.result;
      this.ritualProfile.set(profile);
      if (profile.is_estimated) return;
      const { data } = await this.http.get('/ritual-dna/recommendations?surface=home') as { data: HomePicks };
      if (revision !== this.personalizationRevision) return;
      const [catalogResult, recipeResult, recipeFallbackResult] = await Promise.allSettled([
        firstValueFrom(this.productsApi.getProducts()),
        Promise.allSettled(data.recipes.map(pick => firstValueFrom(this.recipesApi.getRecipeBySlug(pick.slug)))),
        firstValueFrom(this.recipesApi.getFeaturedRecipes())
      ]);
      if (revision !== this.personalizationRevision) return;
      if (catalogResult.status === 'fulfilled') {
        const catalog = new Map(catalogResult.value.map(product => [String(product.product_id), product]));
        const products: Product[] = [];
        const fits: Record<number, { percent: number; name: string; archetypeId: string }> = {};
        for (const pick of [...data.products].sort((a, b) => (b.fit_percent ?? -1) - (a.fit_percent ?? -1))) {
          const product = catalog.get(String(pick.id));
          if (!product || product.is_active === false || isProductOutOfStock(product) || products.some(item => item.product_id === product.product_id)) continue;
          products.push(product);
          if (Number.isFinite(pick.fit_percent) && profile.archetype) {
            fits[product.product_id] = { percent: Math.max(0, Math.min(100, Math.round(pick.fit_percent!))), name: profile.archetype.name, archetypeId: profile.archetype.id };
          }
        }
        this.ritualFits.set(fits);
        this.ritualProducts.set(products.slice(0, 20));
      }
      const matchedRecipes = recipeResult.status === 'fulfilled'
        ? recipeResult.value.flatMap(result => result.status === 'fulfilled' ? [result.value] : []) : [];
      const extraRecipes = recipeFallbackResult.status === 'fulfilled' ? recipeFallbackResult.value : [];
      const seenRecipes = new Set<string>();
      this.ritualRecipes.set([...matchedRecipes, ...extraRecipes].filter(recipe => {
        if (seenRecipes.has(recipe.recipe_id)) return false;
        seenRecipes.add(recipe.recipe_id);
        return true;
      }).slice(0, 10));
    } catch {
      if (revision === this.personalizationRevision) this.ritualProfileLoading.set(false);
      // Keep the default catalog sections available if personalization fails.
    }
  }

  readonly recipeDetailEntryState = { contentEntrySource: 'homepage' };

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.savedScrollY = this.getSavedScrollPosition();
    this.routerEventsSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        this.saveScrollPosition();
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.savedScrollY === null || !isPlatformBrowser(this.platformId)) return;

    const scrollY = this.savedScrollY;
    const restore = (): void => window.scrollTo({ top: scrollY, behavior: 'auto' });

    requestAnimationFrame(() => {
      restore();
      [100, 300, 700].forEach(delay => {
        this.scrollRestoreTimers.push(setTimeout(restore, delay));
      });
    });
  }

  ngOnDestroy(): void {
    this.personalizationRevision++;
    this.routerEventsSubscription?.unsubscribe();
    this.scrollRestoreTimers.forEach(timer => clearTimeout(timer));
  }

  private saveScrollPosition(): void {
    window.history.replaceState(
      { ...window.history.state, homeScrollY: window.scrollY },
      '',
      window.location.href
    );
  }

  private getSavedScrollPosition(): number | null {
    const scrollY = window.history.state?.homeScrollY;
    return typeof scrollY === 'number' && Number.isFinite(scrollY)
      ? Math.max(0, scrollY)
      : null;
  }
}
