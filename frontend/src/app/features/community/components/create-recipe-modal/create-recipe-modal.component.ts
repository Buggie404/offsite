import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideX, LucideCamera, LucideCircleCheck, LucideTrash2, LucideClock } from '@lucide/angular';

import { CloudinaryService } from '../../services/cloudinary.service';
import { RecipeService } from '../../../home/services/recipe.service';
import { Difficulty } from '../../../home/models/recipe.model';
import { InlineValidator, FieldConfig } from '../../../../shared/utils/inline-validator';
import { ProductTag } from '../../models/post.model';
import { ProductPickerComponent } from '../product-picker/product-picker.component';

type ServeStyle = 'HOT' | 'COLD' | 'DESSERT';
type RecipeBase = 'MATCHA' | 'COFFEE' | 'OTHERS';

interface IngredientForm {
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

interface ToolForm {
  name: string;
}

interface StepForm {
  title: string;
  description: string;
  minutes: string;
  seconds: string;
  timerOpen: boolean;
}

const SERVE_STYLES: ServeStyle[] = ['HOT', 'COLD', 'DESSERT'];
const BASE_OPTIONS: { value: RecipeBase; label: string }[] = [
  { value: 'MATCHA', label: 'Matcha' },
  { value: 'COFFEE', label: 'Coffee' },
  { value: 'OTHERS', label: 'Others' },
];
const ALL_DIFFICULTIES: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const UNITS = ['g', 'ml', 'cup', 'tsp', 'tbsp', 'oz', 'piece', 'pinch'];

@Component({
  selector: 'app-create-recipe-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductPickerComponent, LucideX, LucideCamera, LucideCircleCheck, LucideTrash2, LucideClock],
  templateUrl: './create-recipe-modal.component.html',
  styleUrls: ['./create-recipe-modal.component.scss'],
})
export class CreateRecipeModalComponent implements AfterViewInit, OnDestroy {
  private cloudinary = inject(CloudinaryService);
  private recipeService = inject(RecipeService);
  private router = inject(Router);

  private readonly fieldConfigs: FieldConfig[] = [
    {
      field_id: 'recipe-title-input',
      error_element_id: 'recipe-title-error',
      rules: [{ sequence: 1, type: 'LENGTH_CHECK', min_length: 1, error_message: 'Recipe title is required.' }],
    },
    {
      field_id: 'recipe-description-textarea',
      error_element_id: 'recipe-description-error',
      rules: [{ sequence: 1, type: 'LENGTH_CHECK', min_length: 1, error_message: 'Description is required.' }],
    },
    {
      field_id: 'recipe-difficulty-select',
      error_element_id: 'recipe-difficulty-error',
      rules: [{ sequence: 1, type: 'LENGTH_CHECK', min_length: 1, error_message: 'Please select a difficulty.' }],
    },
    {
      field_id: 'recipe-servings-input',
      error_element_id: 'recipe-servings-error',
      rules: [
        { sequence: 1, type: 'EMPTY_CHECK', condition: "value === ''", action: 'CLEAR_ERROR_AND_STOP' },
        {
          sequence: 2,
          type: 'FORMAT_CHECK',
          condition: 'isNaN(Number(value)) || Number(value) <= 0',
          error_message: 'Servings must be a number greater than 0.',
        },
      ],
    },
    {
      field_id: 'recipe-preptime-input',
      error_element_id: 'recipe-preptime-error',
      rules: [
        { sequence: 1, type: 'EMPTY_CHECK', condition: "value === ''", action: 'CLEAR_ERROR_AND_STOP' },
        {
          sequence: 2,
          type: 'FORMAT_CHECK',
          condition: 'isNaN(Number(value)) || Number(value) <= 0',
          error_message: 'Prep time must be a number greater than 0.',
        },
      ],
    },
  ];

  private validator = new InlineValidator(this.fieldConfigs);

  ngAfterViewInit(): void {
    this.validator.attach(document);
  }

  ngOnDestroy(): void {
    this.validator.detach();
  }

  onFieldBlur(fieldId: string): void {
    this.validator.validateField(fieldId);
  }

  private static readonly NUMERIC_ALLOWED_KEYS = new Set([
    'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End',
  ]);

  blockNonNumericKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (CreateRecipeModalComponent.NUMERIC_ALLOWED_KEYS.has(event.key)) return;
    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  }

  blockQuantityKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (CreateRecipeModalComponent.NUMERIC_ALLOWED_KEYS.has(event.key)) return;
    if (/^[0-9./\-\s]$/.test(event.key) || event.key === ',') return;
    event.preventDefault();
  }

  sanitizeNumericPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const digitsOnly = text.replace(/[^0-9]/g, '');
    const target = event.target as HTMLInputElement;
    target.value = digitsOnly;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  sanitizeQuantityPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const cleaned = text.replace(/[^0-9./\-\s,]/g, '').replace(/,/g, '.').replace(/[–—]/g, '-');
    const target = event.target as HTMLInputElement;
    target.value = cleaned;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  sanitizeNumberInput(event: Event, field: 'servings' | 'prepTime'): void {
    const input = event.target as HTMLInputElement;
    const sanitized = input.value.replace(/[^0-9]/g, '');

    if (input.value !== sanitized) {
      input.value = sanitized;
    }

    if (field === 'servings') {
      this.servings = sanitized ? Number(sanitized) : null;
    } else {
      this.prepTime = sanitized ? Number(sanitized) : null;
    }
  }

  onQuantityInput(event: Event, idx: number): void {
    const input = event.target as HTMLInputElement;
    const sanitized = input.value
      .replace(/,/g, '.')
      .replace(/[–—]/g, '-')
      .replace(/[^0-9./\-\s]/g, '');
    if (input.value !== sanitized) input.value = sanitized;
    this.ingredients[idx].quantity = sanitized;
  }

  @Output() close = new EventEmitter<void>();

  readonly serveStyles = SERVE_STYLES;
  readonly baseOptions = BASE_OPTIONS;
  readonly allDifficulties = ALL_DIFFICULTIES;
  readonly units = UNITS;

  // ----- Hero image -----
  heroFile: File | null = null;
  heroPreview: string | null = null;

  // ----- Basic info -----
  title = '';
  description = '';

  // ----- Recipe details -----
  base: RecipeBase | '' = '';
  servings: number | null = null;
  prepTime: number | null = null;
  difficulty: Difficulty | '' = '';

  // ----- Ingredients / Tools / Steps -----
  ingredients: IngredientForm[] = [this.emptyIngredient()];
  tools: ToolForm[] = [];
  steps: StepForm[] = [this.emptyStep()];

  // ----- Sản phẩm gắn vào bài community (tối đa 3) -----
  linkedProducts: ProductTag[] = [];
  @ViewChild(ProductPickerComponent) private productPicker?: ProductPickerComponent;
  @ViewChild('ingredientsSection') private ingredientsSection?: ElementRef<HTMLElement>;
  @ViewChild('toolsSection') private toolsSection?: ElementRef<HTMLElement>;
  @ViewChild('stepsSection') private stepsSection?: ElementRef<HTMLElement>;

  // Nội dung dùng để gợi ý sản phẩm: tiêu đề + mô tả + nguyên liệu + dụng cụ
  get suggestContent(): string {
    return [
      ...this.ingredients.map(i => i.name),
      ...this.tools.map(t => t.name),
    ].filter(s => s && s.trim()).join(' ');
  }

  // ----- Serve style (multi select) -----
  selectedServeStyles: ServeStyle[] = ['HOT'];

  isSubmitting = false;
  errorMessage = '';
  showDiscardConfirm = false;

  // ----- Touched flags (gate inline errors for non-InlineValidator fields) -----
  photoTouched = false;
  baseTouched = false;
  ingredientsTouched = false;
  stepsTouched = false;
  timerTouched = false;

  private isPositiveOrEmpty(value: number | null): boolean {
    return value === null || (typeof value === 'number' && !isNaN(value) && value > 0);
  }

  get hasValidIngredient(): boolean {
    return this.ingredients.some(i => i.name.trim().length > 0);
  }

  get hasValidStep(): boolean {
    return this.steps.some(s => s.title.trim().length > 0 || s.description.trim().length > 0);
  }

  get hasValidTimers(): boolean {
    return this.steps.every(s => this.timerSeconds(s) !== 'invalid');
  }

  get showPhotoError(): boolean {
    return this.photoTouched && !this.heroFile;
  }

  get showBaseError(): boolean {
    return this.baseTouched && !this.base;
  }

  get showIngredientsError(): boolean {
    return this.ingredientsTouched && !this.hasValidIngredient;
  }

  get showStepsError(): boolean {
    return this.stepsTouched && !this.hasValidStep;
  }

  get showTimerError(): boolean {
    return this.timerTouched && !this.hasValidTimers;
  }

  get isFormValid(): boolean {
    return (
      this.title.trim().length > 0 &&
      this.description.trim().length > 0 &&
      !!this.heroFile &&
      !!this.base &&
      !!this.difficulty &&
      this.hasValidIngredient &&
      this.hasValidQuantities &&
      this.hasValidStep &&
      this.hasValidTimers &&
      this.isPositiveOrEmpty(this.servings) &&
      this.isPositiveOrEmpty(this.prepTime)
    );
  }

  private emptyIngredient(): IngredientForm {
    return { name: '', quantity: '', unit: '' };
  }

  get hasValidQuantities(): boolean {
    return this.ingredients.every(item => !item.name.trim() || isValidQuantity(item.quantity));
  }

  private emptyStep(): StepForm {
    return { title: '', description: '', minutes: '', seconds: '', timerOpen: false };
  }

  onHeroFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (this.heroPreview) URL.revokeObjectURL(this.heroPreview);
    this.heroFile = file;
    this.heroPreview = URL.createObjectURL(file);
    this.photoTouched = true;
    input.value = '';
  }

  removeHeroImage(): void {
    if (this.heroPreview) URL.revokeObjectURL(this.heroPreview);
    this.heroFile = null;
    this.heroPreview = null;
    this.photoTouched = true;
  }

  serveStyleOn(style: ServeStyle): boolean {
    return this.selectedServeStyles.includes(style);
  }

  toggleServeStyle(style: ServeStyle): void {
    this.selectedServeStyles = this.serveStyleOn(style)
      ? this.selectedServeStyles.filter(item => item !== style)
      : [...this.selectedServeStyles, style];
    this.selectedServeStyles = this.serveStyles.filter(item => this.selectedServeStyles.includes(item));
  }

  selectBase(value: RecipeBase): void {
    this.base = value;
    this.baseTouched = true;
  }

  addIngredient(): void {
    this.ingredients.push(this.emptyIngredient());
    this.scrollSectionBottom(this.ingredientsSection);
  }

  removeIngredient(index: number): void {
    if (this.ingredients.length === 1) return;
    this.ingredients.splice(index, 1);
  }

  addTool(): void {
    this.tools.push({ name: '' });
    this.scrollSectionBottom(this.toolsSection);
  }

  removeTool(index: number): void {
    this.tools.splice(index, 1);
  }

  addStep(): void {
    this.steps.push(this.emptyStep());
    this.scrollSectionBottom(this.stepsSection);
  }

  removeStep(index: number): void {
    if (this.steps.length === 1) return;
    this.steps.splice(index, 1);
  }

  private scrollSectionBottom(section?: ElementRef<HTMLElement>): void {
    const host = section?.nativeElement;
    if (!host) return;
    queueMicrotask(() => {
      const button = host.querySelector('.btn-add-row') as HTMLElement | null;
      button?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  openTimer(step: StepForm): void {
    step.timerOpen = true;
  }

  clearTimer(step: StepForm): void {
    step.minutes = '';
    step.seconds = '';
    step.timerOpen = false;
  }

  get hasUnsavedContent(): boolean {
    return (
      this.title.trim().length > 0 ||
      this.description.trim().length > 0 ||
      this.heroFile !== null ||
      this.linkedProducts.length > 0 ||
      this.ingredients.some(i => i.name.trim().length > 0) ||
      this.tools.some(t => t.name.trim().length > 0) ||
      this.steps.some(s => s.title.trim().length > 0 || s.description.trim().length > 0 || s.minutes || s.seconds)
    );
  }

  onRequestClose(): void {
    if (this.hasUnsavedContent) {
      this.showDiscardConfirm = true;
    } else {
      this.close.emit();
    }
  }

  onBackdropClick(): void {
    this.onRequestClose();
  }

  onKeepEditing(): void {
    this.showDiscardConfirm = false;
  }

  onConfirmDiscard(): void {
    this.showDiscardConfirm = false;
    this.resetForm();
    this.close.emit();
  }

  private resetForm(): void {
    this.removeHeroImage();
    this.title = '';
    this.description = '';
    this.linkedProducts = [];
    this.productPicker?.reset();
    this.servings = null;
    this.prepTime = null;
    this.base = '';
    this.difficulty = '';
    this.ingredients = [this.emptyIngredient()];
    this.tools = [];
    this.steps = [this.emptyStep()];
    this.selectedServeStyles = ['HOT'];
    this.errorMessage = '';
    this.photoTouched = false;
    this.baseTouched = false;
    this.ingredientsTouched = false;
    this.stepsTouched = false;
    this.timerTouched = false;
    this.validator.clearAll();
  }

  private timerSeconds(step: StepForm): number | null | 'invalid' {
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

  submitRecipe(): void {
    if (this.isSubmitting) return;

    this.photoTouched = true;
    this.baseTouched = true;
    this.ingredientsTouched = true;
    this.stepsTouched = true;
    this.timerTouched = true;
    this.validator.validateAll();

    if (!this.isFormValid || !this.heroFile) {
      this.errorMessage = 'Please complete all required fields correctly.';
      return;
    }

    const validIngredients = this.ingredients.filter(i => i.name.trim().length > 0);
    const validSteps = this.steps.filter(s => s.title.trim().length > 0 || s.description.trim().length > 0);

    this.errorMessage = '';
    this.isSubmitting = true;

    this.cloudinary.uploadFile(this.heroFile).subscribe({
      next: uploaded => {
        const formData = new FormData();
        formData.append('title', this.title.trim());
        formData.append('description', this.description.trim());
        formData.append(
          'heroImage',
          JSON.stringify({ url: uploaded.url, public_id: uploaded.public_id }),
        );
        formData.append(
          'metadata',
          JSON.stringify({
            servings: this.servings ?? 1,
            prepTime: this.prepTime ?? 0,
            cookTime: null,
            difficulty: this.difficulty || 'EASY',
            base: this.base,
            tags: [...this.selectedServeStyles],
          }),
        );
        formData.append(
          'ingredients',
          JSON.stringify(
            validIngredients.map(i => ({
              name: i.name.trim(),
              quantity: normalizeQuantity(i.quantity),
              unit: i.unit.trim(),
              optional: false,
            })),
          ),
        );
        formData.append(
          'tools',
          JSON.stringify(
            this.tools
              .filter(t => t.name.trim().length > 0)
              .map(t => ({ name: t.name.trim() })),
          ),
        );
        formData.append(
          'steps',
          JSON.stringify(
            validSteps.map((s, idx) => {
              const timer = this.timerSeconds(s);
              return {
                order: idx + 1,
                title: s.title.trim() || `Step ${idx + 1}`,
                description: s.description.trim(),
                timerSeconds: timer === 'invalid' ? null : timer,
              };
            }),
          ),
        );

        // Backend: gắn tối đa 3 sản phẩm vào bài community được tạo kèm recipe
        formData.append('linked_products', JSON.stringify(this.linkedProducts.slice(0, 3).map(p => p.product_id)));

        this.recipeService.createRecipe(formData).subscribe({
          next: (res: any) => {
            this.isSubmitting = false;

            // 🚀 Lấy post_id từ Backend
            const postId = res.post_id;

            this.resetForm();
            this.close.emit();

            // 🚀 Tự động chuyển hướng tới bài viết Community chi tiết
            if (postId) {
              this.router.navigate(['/community/post', postId]);
            } else {
              window.location.reload();
            }
          },
          error: () => {
            this.isSubmitting = false;
            this.errorMessage = 'Failed to publish recipe. Please try again.';
          },
        });
      },
      error: () => {
        this.isSubmitting = false;
        this.errorMessage = 'Failed to upload cover photo. Please try again.';
      },
    });
  }
}
