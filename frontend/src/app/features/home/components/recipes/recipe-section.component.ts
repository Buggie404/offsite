// ─────────────────────────────────────────────────────────────
//  components/recipe-section/recipe-section.component.ts
// ─────────────────────────────────────────────────────────────

import { Component, Input, OnChanges, OnInit, SimpleChanges, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Recipe } from '../../models/recipe.model';
import { RecipeService } from '../../services/recipe.service';
import { LucideArrowRight, LucideClock, LucideDroplet, LucideHeart, LucideStar } from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

@Component({
  selector: 'app-recipe-section',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideArrowRight, LucideClock, LucideDroplet, LucideHeart, LucideStar],
  templateUrl: './recipe-section.component.html',
  styleUrls: ['./recipe-section.component.scss'],
})
export class RecipeSectionComponent implements OnInit, OnChanges {
  @Input() sectionHeading = 'Brew It Yourself';
  @Input() compact = false;
  @Input() baseFilter: 'matcha' | 'coffee' | null = null;
  @Input() showViewAll = true;

  // ── State ────────────────────────────────────────────────────
  recipes: Recipe[]    = [];
  isLoading            = true;
  error: string | null = null;
  savedRecipeIds = new Set<string>();

  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private recipeService: RecipeService,
    private authService: AuthService,
    private authPromptService: AuthPromptModalService
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadSavedRecipes();
    this.loadRecipes();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['baseFilter'] || changes['baseFilter'].firstChange) return;
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadRecipes();
  }

  // ── Helpers ──────────────────────────────────────────────────

  /** Raw tag làm label luôn: HOT, COLD, DESSERT, COCKTAIL */
  getBadgeLabel(recipe: Recipe): string {
    return recipe.metadata.tags[0] ?? '';
  }

  /** Màu nền badge theo tag */
  getBadgeColor(recipe: Recipe): string {
    const tag = recipe.metadata.tags[0] ?? '';
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
    const title = recipe.title.toLowerCase();
    const tags = recipe.metadata.tags.map(tag => tag.toLowerCase());

    if (title.includes('matcha') || tags.includes('matcha')) return 'Matcha';
    if (title.includes('coffee') || tags.includes('coffee')) return 'Coffee';
    return 'Others';
  }

  isSaved(recipe: Recipe): boolean {
    return this.savedRecipeIds.has(recipe.recipe_id);
  }

  async toggleFavorite(recipe: Recipe, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }

    try {
      const result = await this.authService.toggleSavedRecipe(recipe.recipe_id);
      if (result.saved) this.savedRecipeIds.add(recipe.recipe_id);
      else this.savedRecipeIds.delete(recipe.recipe_id);
      recipe.saves = Math.max(0, (recipe.saves || 0) + (result.saved ? 1 : -1));
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to save recipe:', err);
    }
  }

  // ── Data loading ─────────────────────────────────────────────

  private loadRecipes(): void {
    this.isLoading = true;
    this.error     = null;

    const request$ = this.baseFilter
      ? this.recipeService.getRecipes(24)
      : this.recipeService.getMostSavedRecipes(3);

    request$.subscribe({
      next: (data) => {
        this.recipes = this.baseFilter
          ? data
              .filter(recipe => this.matchesBaseFilter(recipe))
              .sort((a, b) => (b.saves || 0) - (a.saves || 0))
              .slice(0, 3)
          : data;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load recipes:', err);
        this.error     = 'Could not load recipes.';
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  private matchesBaseFilter(recipe: Recipe): boolean {
    if (!this.baseFilter) return true;

    const haystack = [
      recipe.slug,
      recipe.title,
      recipe.description,
      ...(recipe.metadata.tags ?? []),
      ...(recipe.ingredients ?? []).map(ingredient => ingredient.name),
      ...(recipe.tools ?? []).map(tool => tool.name),
      ...(recipe.steps ?? []).flatMap(step => [step.title, step.description])
    ].join(' ').toLowerCase();

    const hasMatcha = /\bmatcha\b|\bgreen tea\b|\bchasen\b|\bwhisk\b/.test(haystack);
    const hasCoffee = /\bcoffee\b|\bespresso\b|\bcold brew\b|\bpour over\b|\baeropress\b|\bchemex\b|\bv60\b|\bdrip\b/.test(haystack);

    if (this.baseFilter === 'coffee') {
      if (hasMatcha) return false;
      return haystack.includes('coffee')
        || haystack.includes('espresso')
        || haystack.includes('cold brew')
        || haystack.includes('pour over');
    }

    if (hasCoffee && !hasMatcha) return false;
    return hasMatcha;
  }

  private async loadSavedRecipes(): Promise<void> {
    if (!this.authService.isAuthenticated()) return;

    try {
      const result = await this.authService.getSavedItems();
      this.savedRecipeIds = new Set(
        (result.saved_recipes || [])
          .map((item: any) => item.recipe?.recipe_id ?? item.recipe_id)
          .filter(Boolean)
      );
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load saved recipes:', err);
    }
  }
}
