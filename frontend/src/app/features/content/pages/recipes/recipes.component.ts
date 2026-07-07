import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ContentService } from '../../services/content.service';
import { Recipe } from '../../../../shared/models/recipe.model';
import { 
  LucideSearch, 
  LucideChevronDown, 
  LucideDroplet, 
  LucideClock, 
  LucideStar, 
  LucideHeart, 
  LucideX,
  LucideSearchX,
  LucideRotateCcw
} from '@lucide/angular';

import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { AuthService } from '../../../../core/auth.service';
import { BackToTopComponent } from '../../../../shared/components/back-to-top/back-to-top.component';

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    RouterModule,
    LucideSearch,
    LucideChevronDown,
    LucideDroplet,
    LucideClock,
    LucideStar,
    LucideHeart,
    LucideX,
    LucideSearchX,
    LucideRotateCcw,
    BackToTopComponent
  ],
  templateUrl: './recipes.component.html',
  styleUrl: './recipes.component.scss'
})
export class RecipesComponent implements OnInit {
  private contentService = inject(ContentService);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);
  private authService = inject(AuthService);
  private authPromptService = inject(AuthPromptModalService);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  // Raw list from backend
  allRecipes: Recipe[] = [];
  // Filtered and sorted list displayed to user
  filteredRecipes: Recipe[] = [];

  isLoading = false;
  error: string | null = null;

  // Search & Filter State
  searchQuery = '';
  selectedBase = 'ALL';
  selectedStyle = 'ALL';
  selectedSort = 'popularity';
  isSortDropdownOpen = false;

  bases = ['ALL', 'MATCHA', 'COFFEE', 'OTHERS'];
  styles = ['ALL', 'HOT', 'COLD', 'DESSERT'];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.route.queryParams.subscribe(params => {
        if (params['base']) {
          this.selectedBase = params['base'].toUpperCase();
        }
        if (params['style']) {
          this.selectedStyle = params['style'].toUpperCase();
        }
        this.fetchRecipes();
      });
    }
  }

  fetchRecipes(): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.detectChanges();

    this.contentService.getRecipes().subscribe({
      next: (recipes) => {
        this.allRecipes = recipes;
        if (this.authService.isAuthenticated()) {
          this.http.get<any>('/api/auth/saved-items').subscribe({
            next: (res) => {
              const savedIds = new Set((res.saved_recipes || []).map((sr: any) => sr.recipe?.recipe_id).filter(Boolean));
              this.allRecipes.forEach(r => {
                (r as any).isFavorited = savedIds.has(r.recipe_id);
              });
              this.applyFilters();
              this.isLoading = false;
              this.cdr.detectChanges();
            },
            error: (err) => {
              console.error('Error fetching saved items:', err);
              this.applyFilters();
              this.isLoading = false;
              this.cdr.detectChanges();
            }
          });
        } else {
          this.applyFilters();
          this.isLoading = false;
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.error('Error fetching recipes:', err);
        this.error = 'Failed to load recipes. Please try again later.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  applyFilters(): void {
    let result = [...this.allRecipes];

    // 1. Search Query filter
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      result = result.filter(r => 
        r.title.toLowerCase().includes(q) || 
        (r.description && r.description.toLowerCase().includes(q))
      );
    }

    // 2. Base Category filter
    if (this.selectedBase !== 'ALL') {
      const baseLower = this.selectedBase.toLowerCase();
      result = result.filter(r => {
        const titleLower = r.title.toLowerCase();
        const hasMatcha = titleLower.includes('matcha') || r.metadata.tags.some((t: string) => t.toLowerCase() === 'matcha');
        const hasCoffee = titleLower.includes('coffee') || r.metadata.tags.some((t: string) => t.toLowerCase() === 'coffee');

        if (baseLower === 'matcha') return hasMatcha;
        if (baseLower === 'coffee') return hasCoffee;
        if (baseLower === 'others') return !hasMatcha && !hasCoffee;
        return true;
      });
    }

    // 3. Style filter
    if (this.selectedStyle !== 'ALL') {
      const styleUpper = this.selectedStyle.toUpperCase();
      result = result.filter(r => r.metadata.tags.includes(styleUpper));
    }

    // 4. Sorting
    if (this.selectedSort === 'popularity') {
      result.sort((a, b) => (b.saves || 0) - (a.saves || 0));
    } else if (this.selectedSort === 'newest') {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (this.selectedSort === 'name-asc') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (this.selectedSort === 'name-desc') {
      result.sort((a, b) => b.title.localeCompare(a.title));
    } else if (this.selectedSort === 'time-asc') {
      result.sort((a, b) => (a.metadata?.prepTime || 0) - (b.metadata?.prepTime || 0));
    } else if (this.selectedSort === 'time-desc') {
      result.sort((a, b) => (b.metadata?.prepTime || 0) - (a.metadata?.prepTime || 0));
    }

    this.filteredRecipes = result;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.applyFilters();
  }

  setBase(base: string): void {
    this.selectedBase = base;
    this.applyFilters();
  }

  setStyle(style: string): void {
    this.selectedStyle = style;
    this.applyFilters();
  }

  toggleSortDropdown(): void {
    this.isSortDropdownOpen = !this.isSortDropdownOpen;
  }

  selectSort(sort: string): void {
    this.selectedSort = sort;
    this.isSortDropdownOpen = false;
    this.applyFilters();
  }

  getSortLabel(): string {
    if (this.selectedSort === 'popularity') return 'POPULARITY';
    if (this.selectedSort === 'newest') return 'NEWEST';
    if (this.selectedSort === 'name-asc') return 'NAME (A-Z)';
    if (this.selectedSort === 'name-desc') return 'NAME (Z-A)';
    if (this.selectedSort === 'time-asc') return 'TIME (SHORT FIRST)';
    if (this.selectedSort === 'time-desc') return 'TIME (LONG FIRST)';
    return this.selectedSort.toUpperCase();
  }

  // Helper Methods for Recipe Cards
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

    this.http.post<any>('/api/auth/saved-recipes', { recipeId: recipe.recipe_id }).subscribe({
      next: (res) => {
        (recipe as any).isFavorited = res.saved;
        if (res.saved) {
          recipe.saves += 1;
        } else {
          recipe.saves = Math.max(0, recipe.saves - 1);
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
}
