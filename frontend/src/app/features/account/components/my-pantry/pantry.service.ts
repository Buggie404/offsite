import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpService } from '../../../../core/http.service';
import { currentBrewOwnerId, readBrewProgress, recipeIdFromProgressKey } from '../../../content/components/brew-coach/brew-progress';
import { PantryCoverage, PantryItem, PantryMissing, PantryRecipe, PantrySnapshot, PantrySuggestions } from './pantry.model';

@Injectable({ providedIn: 'root' })
export class PantryService {
  private http = inject(HttpService);
  private platformId = inject(PLATFORM_ID);

  private localStartsSynced = false;
  private brewStartsInFlight = new Set<string>();

  readonly items = signal<PantryItem[]>([]);
  readonly recipes = signal<PantryRecipe[]>([]);
  readonly suggestions = signal<PantrySuggestions>({ ready: [], almost: [], readyTotal: 0, almostTotal: 0 });
  readonly missing = signal<PantryMissing[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly expiringCount = computed(
    () => this.items().filter(item => this.isExpiring(item)).length,
  );

  readonly expiredCount = computed(
    () => this.items().filter(item => this.isExpired(item)).length,
  );

  constructor() {
    if (isPlatformBrowser(this.platformId)) void this.refresh();
  }

  isExpiring(item: PantryItem): boolean {
    return item.status !== 'used_up' && item.countdown === 'danger';
  }

  isExpired(item: PantryItem): boolean {
    return item.status !== 'used_up' && (item.countdown === 'expired' || item.status === 'expired');
  }

  isRunningLow(item: PantryItem): boolean {
    if (item.status !== 'active' || item.countdown === 'expired' || item.countdown === 'used_up') return false;
    if (item.category === 'tools' || item.category === 'drinkware' || item.category === 'sets_bundles') return false;
    const quantity = item.quantity;
    if (quantity == null || quantity <= 0) return false;
    const unit = (item.unit || '').trim().toLowerCase();
    if (unit === 'g') return quantity <= 10;
    if (unit === 'kg') return quantity <= 0.01;
    if (unit === 'ml') return quantity <= 100;
    if (unit === 'l') return quantity <= 0.1;
    if (unit === 'tsp') return quantity <= 3;
    if (unit === 'tbsp') return quantity <= 1;
    if (unit === 'oz') return quantity <= 1;
    if (unit === 'cup') return quantity <= 0.25;
    return false;
  }

  needsRestock(item: PantryItem): boolean {
    return item.status === 'used_up'
      || item.countdown === 'used_up'
      || this.isExpired(item)
      || this.isExpiring(item)
      || item.countdown === 'warning'
      || this.isRunningLow(item);
  }

  canBuyAgain(item: PantryItem): boolean {
    if (!this.needsRestock(item)) return false;
    if (item.purchasable === false) return false;
    if (item.purchasable === true) return true;
    return !!(item.productId && item.productSlug);
  }

  async refresh(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !localStorage.getItem('token')) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await this.syncLocalBrewStarts();
      const snapshot = await this.http.get('/pantry') as PantrySnapshot;
      this.apply(snapshot);
    } catch (error) {
      this.error.set(this.message(error, 'Could not load your pantry.'));
    } finally {
      this.loading.set(false);
    }
  }

  async addItem(input: {
    name: string;
    expiryDate: string;
    quantity?: number;
    unit?: string;
  }): Promise<void> {
    const snapshot = await this.http.post('/pantry/items', {
      name: input.name,
      expiry_date: input.expiryDate || null,
      ...(input.quantity != null && input.unit
        ? { quantity: input.quantity, unit: input.unit }
        : {}),
    }) as PantrySnapshot;
    this.apply(snapshot);
  }

  coverage(recipeId: string): Promise<PantryCoverage> {
    return this.http.get(`/pantry/recipes/${encodeURIComponent(recipeId)}/coverage`) as Promise<PantryCoverage>;
  }

  async markUsedUp(id: string): Promise<void> {
    const snapshot = await this.http.patch(`/pantry/items/${encodeURIComponent(id)}`, { action: 'used_up' }) as PantrySnapshot;
    this.apply(snapshot);
  }

  async removeItem(id: string): Promise<void> {
    const snapshot = await this.http.patch(`/pantry/items/${encodeURIComponent(id)}`, { action: 'remove' }) as PantrySnapshot;
    this.apply(snapshot);
  }

  async markRecipeDone(id: string): Promise<void> {
    const snapshot = await this.http.post(`/pantry/recipes/${encodeURIComponent(id)}/done`, {}) as PantrySnapshot;
    this.apply(snapshot);
  }

  async hideRecipes(ids: string[]): Promise<void> {
    const snapshot = await this.http.post('/pantry/recipes/hide', { recipe_ids: ids }) as PantrySnapshot;
    this.apply(snapshot);
  }

  recordBrewStart(recipeId: string): void {
    if (!recipeId || !isPlatformBrowser(this.platformId) || !localStorage.getItem('token')) return;
    void this.postBrewStart(recipeId);
  }

  private async syncLocalBrewStarts(): Promise<void> {
    if (this.localStartsSynced || !isPlatformBrowser(this.platformId)) return;
    this.localStartsSynced = true;
    const ownerId = currentBrewOwnerId();
    const ids: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const recipeId = recipeIdFromProgressKey(key, ownerId);
      if (recipeId && !ids.includes(recipeId)) ids.push(recipeId);
    }
    for (const recipeId of ids) {
      await this.postBrewStart(recipeId);
    }
  }

  private postBrewStart(recipeId: string): Promise<void> {
    if (this.brewStartsInFlight.has(recipeId)) return Promise.resolve();
    this.brewStartsInFlight.add(recipeId);
    return this.http.post('/pantry/brew-starts', { recipe_id: recipeId })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => this.brewStartsInFlight.delete(recipeId));
  }

  applyBrewResult(recipeId: string, coverage: PantryCoverage): void {
    const stock = new Map<string, { quantity: number | null; unit: string }>();
    for (const row of coverage.stock || []) {
      if (row?.id) stock.set(row.id, { quantity: row.quantity, unit: row.unit || '' });
    }
    if (stock.size) {
      this.items.update(items => items.map(item => {
        const next = stock.get(item.id);
        if (!next) return item;
        const quantity = next.quantity;
        const unit = next.unit || item.unit;
        const usedUp = quantity != null && quantity <= 0;
        return {
          ...item,
          quantity,
          unit,
          quantityLabel: this.quantityLabel(quantity, unit),
          status: usedUp ? 'used_up' : item.status,
          countdown: usedUp ? 'used_up' : item.countdown,
        };
      }));
    }
    if (!recipeId) return;
    this.recipes.update(recipes => recipes.map(recipe => (
      recipe.id === recipeId
        ? { ...recipe, status: 'done', step: recipe.totalSteps || recipe.step }
        : recipe
    )));
  }

  private quantityLabel(quantity: number | null, unit: string): string {
    if (quantity == null || !unit) return '';
    return `${Number.isInteger(quantity) ? quantity : quantity} ${unit}`;
  }

  private apply(snapshot: PantrySnapshot): void {
    this.items.set(snapshot.items || []);
    this.recipes.set(this.withLocalProgress(snapshot.recipes || []));
    const suggestions = snapshot.suggestions;
    this.suggestions.set({
      ready: suggestions?.ready || [],
      almost: suggestions?.almost || [],
      readyTotal: suggestions?.readyTotal || suggestions?.ready?.length || 0,
      almostTotal: suggestions?.almostTotal || suggestions?.almost?.length || 0,
    });
    this.missing.set(snapshot.missing || []);
  }

  private withLocalProgress(recipes: PantryRecipe[]): PantryRecipe[] {
    return recipes.map(recipe => {
      if (recipe.status !== 'progress') return recipe;
      const progress = readBrewProgress(recipe.id);
      if (!progress) return recipe;
      const step = Math.min(recipe.totalSteps, Math.max(1, progress.stepIndex + 1));
      return { ...recipe, step };
    });
  }

  private message(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
      return error.error;
    }
    return fallback;
  }
}
