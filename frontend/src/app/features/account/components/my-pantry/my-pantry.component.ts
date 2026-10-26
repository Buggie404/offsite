import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideCheck,
  LucideEllipsis,
  LucideHourglass,
  LucidePlay,
  LucidePlus,
  LucideRefreshCw,
  LucideTrash2,
  LucideX,
} from '@lucide/angular';
import { getProductDetailSlug } from '../../../home/models/product.model';
import { Product } from '../../../../shared/models/product.model';
import { CartService } from '../../../purchase/services/cart.service';
import { PantryFilter, PantryItem, PantryMissing, PantryRecipe, PantrySuggestion } from './pantry.model';
import { PantryService } from './pantry.service';

type PantryStatusTag = { label: string; tone: 'warning' | 'danger' | 'expired' | 'neutral' };

@Component({
  selector: 'app-my-pantry',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideCheck,
    LucideEllipsis,
    LucideHourglass,
    LucidePlay,
    LucidePlus,
    LucideRefreshCw,
    LucideTrash2,
    LucideX,
  ],
  templateUrl: './my-pantry.component.html',
  styleUrl: './my-pantry.component.scss',
})
export class MyPantryComponent implements OnInit {
  readonly pantry = inject(PantryService);
  private router = inject(Router);
  private cart = inject(CartService);

  ngOnInit(): void {
    void this.pantry.refresh();
  }

  readonly filter = signal<PantryFilter>('all');
  readonly openMenuId = signal<string | null>(null);
  readonly addOpen = signal(false);
  readonly addError = signal('');
  readonly saving = signal(false);
  readonly selectedRecipeIds = signal<string[]>([]);
  readonly confirmHideOpen = signal(false);

  readonly units = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'oz', 'pcs'];
  addName = '';
  addQuantity = '';
  addUnit = 'g';
  addBestBefore = '';

  readonly counts = computed(() => {
    const items = this.pantry.items();
    return {
      all: items.length,
      expiring: items.filter(item => this.pantry.isExpiring(item)).length,
      expired: items.filter(item => this.pantry.isExpired(item)).length,
    };
  });

  readonly visibleItems = computed(() => {
    const items = this.pantry.items();
    const filter = this.filter();
    if (filter === 'expiring') return items.filter(item => this.pantry.isExpiring(item));
    if (filter === 'expired') return items.filter(item => this.pantry.isExpired(item));
    if (filter === 'offsite') return items.filter(item => item.source !== 'manual');
    if (filter === 'me') return items.filter(item => item.source === 'manual');
    return items;
  });

  @HostListener('document:click')
  closeMenus(): void {
    this.openMenuId.set(null);
  }

  itemsEmptyCopy(): string {
    if (this.filter() !== 'all' && this.pantry.items().length > 0) {
      return 'Nothing in this view. Try another filter, or add something you brew with.';
    }
    return 'Your shelf is quiet. Add what you keep on hand — the brews will find you.';
  }

  setFilter(filter: PantryFilter): void {
    this.filter.set(filter);
    this.openMenuId.set(null);
  }

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === id ? null : id);
  }

  async markUsedUp(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);
    try {
      await this.pantry.markUsedUp(id);
    } catch (error) {
      this.pantry.error.set(this.errorText(error, 'Could not update this item.'));
    }
  }

  async removeItem(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);
    try {
      await this.pantry.removeItem(id);
    } catch (error) {
      this.pantry.error.set(this.errorText(error, 'Could not remove this item.'));
    }
  }

  daysLabel(item: PantryItem): string {
    if (item.countdown === 'expired') return 'Expired';
    if (item.daysLeft === null) return '';
    if (item.daysLeft === 1) return '1 day left';
    return `${item.daysLeft} days left`;
  }

  sourceLabel(item: PantryItem): string {
    if (item.source === 'manual') return 'Added by me';
    if (item.source === 'subscription') return 'Ritual Box';
    return 'Offsite';
  }

  statusTag(item: PantryItem): PantryStatusTag | null {
    if (item.status === 'used_up' || item.countdown === 'used_up') return { label: 'Used up', tone: 'neutral' };
    if (this.pantry.isExpired(item)) return { label: 'Expired', tone: 'expired' };
    if (this.pantry.isExpiring(item)) return { label: 'Expiring', tone: 'danger' };
    if (this.pantry.isRunningLow(item)) return { label: 'Running low', tone: 'warning' };
    return null;
  }

  restockLink(item: PantryItem): string[] {
    const slug = this.restockProductSlug(item);
    return slug ? ['/products', slug] : ['/search'];
  }

  restockQuery(item: PantryItem): { q: string; tab: string } | null {
    if (this.restockProductSlug(item)) return null;
    return { q: item.name, tab: 'PRODUCTS' };
  }

  productLink(product: PantryMissing): string[] {
    return ['/products', getProductDetailSlug({
      name: product.name,
      slug: product.slug,
      _id: product.id,
      product_id: product.productId,
    })];
  }

  priceLabel(product: PantryMissing): string {
    if (product.price == null) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(product.price);
  }

  progressPercent(recipe: PantryRecipe): number {
    if (recipe.status === 'done' || recipe.totalSteps <= 0) return recipe.status === 'done' ? 100 : 0;
    return Math.round((recipe.step / recipe.totalSteps) * 100);
  }

  progressLabel(recipe: PantryRecipe): string {
    if (recipe.status === 'done') {
      const times = recipe.doneCount > 1 ? `${recipe.doneCount} times` : '';
      return ['Completed', times, recipe.completedOn].filter(Boolean).join(' · ');
    }
    return `In progress · step ${recipe.step} of ${recipe.totalSteps}`;
  }

  primaryLabel(recipe: PantryRecipe): string {
    return recipe.status === 'done' ? 'Brew again' : 'Resume';
  }

  openRecipe(recipe: PantryRecipe): void {
    const brew = recipe.status === 'done' ? 'start' : 'resume';
    void this.router.navigate(['/recipes', recipe.slug], { queryParams: { brew } });
  }

  startSuggested(idea: PantrySuggestion): void {
    void this.router.navigate(['/recipes', idea.slug], { queryParams: { brew: 'start' } });
  }

  canAdd(product: PantryMissing): boolean {
    return (product.product?.variants || []).some(variant => (variant.stock ?? 0) > 0);
  }

  addMissing(product: PantryMissing, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!product.product || !this.canAdd(product)) return;
    this.cart.addToCart(product.product as unknown as Product);
  }

  async markDone(recipe: { id: string }): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.pantry.markRecipeDone(recipe.id);
    } catch (error) {
      this.pantry.error.set(this.errorText(error, 'Could not mark this recipe done.'));
    } finally {
      this.saving.set(false);
    }
  }

  allRecipesSelected(): boolean {
    const recipes = this.pantry.recipes();
    const selected = this.selectedRecipeIds();
    return recipes.length > 0 && recipes.every(recipe => selected.includes(recipe.id));
  }

  toggleSelectAllRecipes(): void {
    if (this.allRecipesSelected()) {
      this.selectedRecipeIds.set([]);
      return;
    }
    this.selectedRecipeIds.set(this.pantry.recipes().map(recipe => recipe.id));
  }

  isRecipeSelected(id: string): boolean {
    return this.selectedRecipeIds().includes(id);
  }

  toggleRecipe(id: string): void {
    const selected = this.selectedRecipeIds();
    this.selectedRecipeIds.set(
      selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id],
    );
  }

  async removeRecipe(recipe: PantryRecipe, event: Event): Promise<void> {
    event.stopPropagation();
    await this.hideRecipes([recipe.id]);
  }

  askRemoveSelected(): void {
    if (!this.selectedRecipeIds().length || this.saving()) return;
    this.confirmHideOpen.set(true);
  }

  closeConfirmHide(): void {
    if (this.saving()) return;
    this.confirmHideOpen.set(false);
  }

  async confirmRemoveSelected(): Promise<void> {
    const ids = [...this.selectedRecipeIds()];
    this.confirmHideOpen.set(false);
    if (!ids.length) return;
    await this.hideRecipes(ids);
  }

  openAdd(): void {
    this.addName = '';
    this.addQuantity = '';
    this.addUnit = 'g';
    this.addBestBefore = '';
    this.addError.set('');
    this.addOpen.set(true);
    this.openMenuId.set(null);
  }

  closeAdd(): void {
    if (this.saving()) return;
    this.addOpen.set(false);
    this.addError.set('');
  }

  async submitAdd(): Promise<void> {
    const name = this.addName.trim();
    if (name.length < 2) {
      this.addError.set('Enter an item name.');
      return;
    }
    const quantityText = this.addQuantity.trim();
    let quantity: number | undefined;
    if (quantityText) {
      const value = Number(quantityText);
      if (!Number.isFinite(value) || value <= 0 || value > 100000) {
        this.addError.set('Enter a quantity.');
        return;
      }
      quantity = value;
    }
    this.saving.set(true);
    this.addError.set('');
    try {
      await this.pantry.addItem({
        name,
        expiryDate: this.addBestBefore,
        quantity,
        unit: quantity == null ? undefined : this.addUnit,
      });
      this.filter.set('all');
      this.saving.set(false);
      this.closeAdd();
    } catch (error) {
      this.addError.set(this.errorText(error, 'Could not add this item.'));
      this.saving.set(false);
    }
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  private restockProductSlug(item: PantryItem): string {
    if (!item.productId && !item.productSlug && !item.productName) return '';
    return getProductDetailSlug({
      name: item.productName || '',
      slug: item.productSlug || '',
      _id: item.productId || '',
      product_id: 0,
    });
  }

  private async hideRecipes(ids: string[]): Promise<boolean> {
    if (!ids.length || this.saving()) return false;
    this.saving.set(true);
    try {
      await this.pantry.hideRecipes(ids);
      const removed = new Set(ids);
      this.selectedRecipeIds.set(this.selectedRecipeIds().filter(id => !removed.has(id)));
      return true;
    } catch (error) {
      this.pantry.error.set(this.errorText(error, 'Could not remove these recipes.'));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private errorText(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
      return error.error;
    }
    return fallback;
  }
}
