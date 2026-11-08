import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideChevronDown,
  LucideClock,
  LucideImage,
  LucidePlus,
  LucideTrash2,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';
import { CloudinaryService } from '../../../community/services/cloudinary.service';
import { ProductPickerComponent } from '../../../community/components/product-picker/product-picker.component';
import { ProductTag } from '../../../community/models/post.model';
import { ProductService } from '../../../home/services/product.service';
import { ContentService, OwnRecipeDraft } from '../../services/content.service';
import { Recipe } from '../../../../shared/models/recipe.model';

interface IngredientRow {
  key: number;
  name: string;
  quantity: string;
  unit: string;
}

const QUANTITY_PART = String.raw`(?:\d+\s+)?(?:\d+\/\d+|\d+(?:\.\d+)?|\.\d+)`;
const QUANTITY_PATTERN = new RegExp(`^${QUANTITY_PART}(?:\\s*-\\s*${QUANTITY_PART})?$`);

function isValidQuantity(value: string): boolean {
  const text = value.trim().replace(/,/g, '.').replace(/[–—]/g, '-');
  if (!text) return true;
  return QUANTITY_PATTERN.test(text);
}

function normalizeQuantity(value: string): string | number | null {
  const text = value.trim().replace(/,/g, '.').replace(/[–—]/g, '-');
  if (!text) return null;
  const normalized = text.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  if (/^\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  return normalized;
}

interface ToolRow {
  key: number;
  name: string;
}

interface StepRow {
  key: number;
  title: string;
  description: string;
  minutes: string;
  seconds: string;
  timerOpen: boolean;
}

@Component({
  selector: 'app-edit-recipe-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ProductPickerComponent,
    LucideChevronDown,
    LucideClock,
    LucideImage,
    LucidePlus,
    LucideTrash2,
    LucideTriangleAlert,
    LucideX
  ],
  templateUrl: './edit-recipe-modal.component.html',
  styleUrl: './edit-recipe-modal.component.scss'
})
export class EditRecipeModalComponent implements OnInit, OnDestroy {
  private contentService = inject(ContentService);
  private productService = inject(ProductService);
  private cloudinary = inject(CloudinaryService);
  private cdr = inject(ChangeDetectorRef);
  private platformId = inject(PLATFORM_ID);
  private previousBodyOverflow = '';
  private previousHtmlOverflow = '';
  private coverFile: File | null = null;
  private nextKey = 1;

  @Input({ required: true }) recipe!: Recipe;
  /** Base inferred by the page when the recipe has none stored (matcha, coffee or others). */
  @Input() baseHint = '';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Recipe>();

  readonly baseOptions = [
    { value: 'matcha', label: 'Matcha' },
    { value: 'coffee', label: 'Coffee' },
    { value: 'others', label: 'Others' }
  ];
  readonly serveOptions = [
    { value: 'hot', label: 'Hot' },
    { value: 'cold', label: 'Iced' },
    { value: 'dessert', label: 'Dessert' }
  ];
  readonly difficulties = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Advanced' }
  ];
  readonly units = ['g', 'ml', 'cup', 'tsp', 'tbsp', 'oz', 'piece', 'pinch'];

  title = '';
  description = '';
  base = '';
  serves: string[] = [];
  difficulty = '';
  servings = '1';
  prepTime = '0';
  ingredients: IngredientRow[] = [];
  tools: ToolRow[] = [];
  steps: StepRow[] = [];
  linkedProducts: ProductTag[] = [];
  coverPreview: string | null = null;
  saving = false;
  error = '';

  get suggestContent(): string {
    return [
      this.title,
      ...this.ingredients.map(item => item.name),
      ...this.tools.map(item => item.name),
    ].filter(value => value && value.trim()).join(' ');
  }

  get suggestBase(): 'COFFEE' | 'MATCHA' | null {
    if (this.base === 'matcha') return 'MATCHA';
    if (this.base === 'coffee') return 'COFFEE';
    return null;
  }

  ngOnInit(): void {
    const recipe = this.recipe;
    this.title = recipe.title || '';
    this.description = recipe.description || '';
    this.base = String(recipe.metadata?.base || this.baseHint || '').toLowerCase();
    const tags = (recipe.metadata?.tags || []).map(tag => String(tag).toUpperCase());
    this.serves = this.serveOptions
      .filter(item => tags.includes(item.value.toUpperCase()))
      .map(item => item.value);
    this.difficulty = String(recipe.metadata?.difficulty || '').toLowerCase();
    this.servings = String(recipe.metadata?.servings ?? 1);
    this.prepTime = String(recipe.metadata?.prepTime ?? 0);
    const blankIngredient: Recipe['ingredients'][number] = { name: '', quantity: undefined, unit: '', optional: false };
    this.ingredients = (recipe.ingredients?.length ? recipe.ingredients : [blankIngredient])
      .map(item => ({
        key: this.nextKey++,
        name: item.name || '',
        quantity: item.quantity == null ? '' : String(item.quantity),
        unit: item.unit || ''
      }));
    this.tools = (recipe.tools?.length ? recipe.tools : [{ name: '' }])
      .map(item => ({ key: this.nextKey++, name: item.name || '' }));
    this.steps = (recipe.steps?.length ? recipe.steps : [{ order: 1, title: '', description: '' }])
      .map(item => this.stepFrom(item));
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadLinkedProducts(recipe.relatedProducts || []);
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    this.revokePreview();
    if (!isPlatformBrowser(this.platformId)) return;
    document.body.style.overflow = this.previousBodyOverflow;
    document.documentElement.style.overflow = this.previousHtmlOverflow;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  get coverSrc(): string | null {
    return this.coverPreview || this.recipe.heroImage?.url || null;
  }

  serveOn(value: string): boolean {
    return this.serves.includes(value);
  }

  toggleServe(value: string): void {
    const next = this.serveOn(value)
      ? this.serves.filter(item => item !== value)
      : [...this.serves, value];
    this.serves = this.serveOptions.map(item => item.value).filter(item => next.includes(item));
  }

  trackByKey(_: number, row: { key: number }): number {
    return row.key;
  }

  hasCustomUnit(unit: string): boolean {
    return !!unit && !this.units.includes(unit);
  }

  addIngredient(): void {
    this.ingredients = [...this.ingredients, { key: this.nextKey++, name: '', quantity: '', unit: '' }];
  }

  removeIngredient(index: number): void {
    this.ingredients = this.ingredients.filter((_, itemIndex) => itemIndex !== index);
  }

  addTool(): void {
    this.tools = [...this.tools, { key: this.nextKey++, name: '' }];
  }

  removeTool(index: number): void {
    this.tools = this.tools.filter((_, itemIndex) => itemIndex !== index);
  }

  addStep(): void {
    this.steps = [...this.steps, { key: this.nextKey++, title: '', description: '', minutes: '', seconds: '', timerOpen: false }];
  }

  removeStep(index: number): void {
    this.steps = this.steps.filter((_, itemIndex) => itemIndex !== index);
  }

  openTimer(step: StepRow): void {
    step.timerOpen = true;
  }

  clearTimer(step: StepRow): void {
    step.minutes = '';
    step.seconds = '';
    step.timerOpen = false;
  }

  onCover(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error = 'Cover must be an image.';
      return;
    }
    this.error = '';
    this.revokePreview();
    this.coverFile = file;
    this.coverPreview = URL.createObjectURL(file);
  }

  close(): void {
    if (this.saving) return;
    this.closed.emit();
  }

  save(): void {
    if (this.saving) return;
    const invalid = this.validate();
    if (invalid) {
      this.error = invalid;
      return;
    }
    this.saving = true;
    this.error = '';
    if (this.coverFile) {
      this.cloudinary.uploadFile(this.coverFile).subscribe({
        next: uploaded => this.persist({ url: uploaded.url, public_id: uploaded.public_id }),
        error: () => {
          this.saving = false;
          this.error = 'Could not upload the cover image.';
          this.cdr.markForCheck();
        }
      });
      return;
    }
    this.persist(null);
  }

  private loadLinkedProducts(ids: string[]): void {
    const wanted = [...new Set(ids.map(id => Number(id)).filter(Number.isInteger))].slice(0, 3);
    if (!wanted.length) {
      this.linkedProducts = [];
      return;
    }
    this.productService.getProducts().subscribe({
      next: products => {
        const byId = new Map(products.map(product => [product.product_id, product]));
        this.linkedProducts = wanted
          .map(id => byId.get(id))
          .filter((product): product is NonNullable<typeof product> => !!product)
          .map(product => ({
            product_id: product.product_id,
            name: product.name,
            image_url: product.images?.[0]?.url || null,
          }));
        this.cdr.markForCheck();
      },
      error: () => {
        this.linkedProducts = wanted.map(id => ({ product_id: id, name: `Product #${id}`, image_url: null }));
        this.cdr.markForCheck();
      }
    });
  }

  private persist(hero: { url: string; public_id: string } | null): void {
    const body: OwnRecipeDraft = {
      title: this.title.trim(),
      description: this.description.trim(),
      base: this.base,
      serves: this.serves,
      difficulty: this.difficulty,
      servings: Math.max(1, Math.round(Number(this.servings) || 1)),
      prepTime: Math.max(0, Math.round(Number(this.prepTime) || 0)),
      ingredients: this.ingredients
        .filter(item => item.name.trim())
        .map(item => ({
          name: item.name.trim(),
          quantity: normalizeQuantity(item.quantity),
          unit: item.unit
        })),
      tools: this.tools
        .filter(item => item.name.trim())
        .map(item => ({ name: item.name.trim() })),
      steps: this.steps
        .filter(item => item.title.trim() || item.description.trim())
        .map(item => {
          const timer = this.timerSeconds(item);
          return {
            title: item.title.trim(),
            description: item.description.trim(),
            timer_seconds: timer === 'invalid' ? null : timer
          };
        }),
      related_products: this.linkedProducts.slice(0, 3).map(product => product.product_id),
      // Left out when unchanged: the backend keeps the current cover.
      hero_image: hero
    };

    this.contentService.updateOwnRecipe(this.recipe.recipe_id, body).subscribe({
      next: updated => {
        this.saving = false;
        this.saved.emit(updated);
      },
      error: err => {
        this.saving = false;
        this.error = err?.error?.error || 'Could not save this recipe.';
        this.cdr.markForCheck();
      }
    });
  }

  private validate(): string {
    if (!this.title.trim()) return 'Add a title.';
    if (!this.coverFile && !this.recipe.heroImage?.url) return 'Add a cover image.';
    if (!this.base) return 'Choose a base.';
    if (!this.difficulty) return 'Choose a difficulty.';
    if (!this.ingredients.some(item => item.name.trim())) return 'Add at least one ingredient.';
    if (this.ingredients.some(item => item.name.trim() && !isValidQuantity(item.quantity))) {
      return 'Use amounts like 2, 1/2, 1 1/2, or 6-8.';
    }
    if (this.steps.some(item => this.timerSeconds(item) === 'invalid')) {
      return 'Step timers use minutes and seconds, with seconds under 60.';
    }
    if (!this.steps.some(item => item.title.trim() || item.description.trim())) return 'Add at least one step.';
    return '';
  }

  private timerSeconds(step: StepRow): number | null | 'invalid' {
    const minutes = step.minutes.trim();
    const seconds = step.seconds.trim();
    if (!minutes && !seconds) return null;
    if ((minutes && !/^\d+$/.test(minutes)) || (seconds && !/^\d+$/.test(seconds))) return 'invalid';
    const min = minutes ? Number(minutes) : 0;
    const sec = seconds ? Number(seconds) : 0;
    if (min > 180 || sec > 59) return 'invalid';
    const total = min * 60 + sec;
    return total > 0 ? total : null;
  }

  private stepFrom(step: { title?: string; description?: string; timerSeconds?: number }): StepRow {
    const total = step.timerSeconds && step.timerSeconds > 0 ? step.timerSeconds : 0;
    return {
      key: this.nextKey++,
      title: step.title || '',
      description: step.description || '',
      minutes: total ? String(Math.floor(total / 60)) : '',
      seconds: total ? String(total % 60) : '',
      timerOpen: total > 0
    };
  }

  private revokePreview(): void {
    if (!this.coverPreview) return;
    URL.revokeObjectURL(this.coverPreview);
    this.coverPreview = null;
  }
}
