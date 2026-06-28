// ─────────────────────────────────────────────────────────────
//  components/recipe-section/recipe-section.component.ts
// ─────────────────────────────────────────────────────────────

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Recipe } from '../../models/recipe.model';
import { RecipeService } from '../../services/recipe.service';

@Component({
  selector: 'app-recipe-section',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recipe-section.component.html',
  styleUrls: ['./recipe-section.component.scss'],
})
export class RecipeSectionComponent implements OnInit {
  // ── State ────────────────────────────────────────────────────
  recipes: Recipe[]    = [];
  isLoading            = true;
  error: string | null = null;

  constructor(private recipeService: RecipeService) {}

  ngOnInit(): void {
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

  // ── Data loading ─────────────────────────────────────────────

  private loadRecipes(): void {
    this.isLoading = true;
    this.error     = null;

    this.recipeService.getRecipes(3).subscribe({
      next: (data) => {
        this.recipes   = data.slice(0, 3);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Failed to load recipes:', err);
        this.error     = 'Could not load recipes.';
        this.isLoading = false;
      },
    });
  }
}