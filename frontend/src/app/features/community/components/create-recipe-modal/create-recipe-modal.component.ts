import { AfterViewInit, Component, EventEmitter, OnDestroy, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideX, LucideCamera, LucideCircleCheck, LucideTrash2 } from '@lucide/angular';

import { CloudinaryService } from '../../services/cloudinary.service';
import { RecipeService } from '../../../home/services/recipe.service';
import { Difficulty } from '../../../home/models/recipe.model';
import { InlineValidator, FieldConfig } from '../../../../shared/utils/inline-validator';

type ServeStyle = 'HOT' | 'COLD' | 'DESSERT';

interface IngredientForm {
  name: string;
  quantity: number | null;
  unit: string;
}

interface ToolForm {
  name: string;
}

interface StepForm {
  description: string;
}

const SERVE_STYLES: ServeStyle[] = ['HOT', 'COLD', 'DESSERT'];
const ALL_DIFFICULTIES: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

@Component({
  selector: 'app-create-recipe-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideCamera, LucideCircleCheck, LucideTrash2],
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
    {
      field_id: 'recipe-cooktime-input',
      error_element_id: 'recipe-cooktime-error',
      rules: [
        { sequence: 1, type: 'EMPTY_CHECK', condition: "value === ''", action: 'CLEAR_ERROR_AND_STOP' },
        {
          sequence: 2,
          type: 'FORMAT_CHECK',
          condition: 'isNaN(Number(value)) || Number(value) <= 0',
          error_message: 'Cook time must be a number greater than 0.',
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

  sanitizeNumericPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const digitsOnly = text.replace(/[^0-9]/g, '');
    const target = event.target as HTMLInputElement;
    target.value = digitsOnly;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  sanitizeNumberInput(event: Event, field: 'servings' | 'prepTime' | 'cookTime' | 'ingredient', idx?: number): void {
    const input = event.target as HTMLInputElement;
    const sanitized = input.value.replace(/[^0-9]/g, '');
    
    if (input.value !== sanitized) {
      input.value = sanitized;
    }
    
    const numValue = sanitized ? Number(sanitized) : null;
    if (field === 'servings') {
      this.servings = numValue;
    } else if (field === 'prepTime') {
      this.prepTime = numValue;
    } else if (field === 'cookTime') {
      this.cookTime = numValue;
    } else if (field === 'ingredient' && idx !== undefined) {
      this.ingredients[idx].quantity = numValue;
    }
  }

  @Output() close = new EventEmitter<void>();

  readonly serveStyles = SERVE_STYLES;
  readonly allDifficulties = ALL_DIFFICULTIES;

  // ----- Hero image -----
  heroFile: File | null = null;
  heroPreview: string | null = null;

  // ----- Basic info -----
  title = '';
  description = '';

  // ----- Recipe details -----
  servings: number | null = null;
  prepTime: number | null = null;
  cookTime: number | null = null;
  difficulty: Difficulty | '' = '';

  // ----- Ingredients / Tools / Steps -----
  ingredients: IngredientForm[] = [this.emptyIngredient()];
  tools: ToolForm[] = [];
  steps: StepForm[] = [this.emptyStep()];

  // ----- Serve style (single select) -----
  selectedServeStyle: ServeStyle | null = 'HOT';

  isSubmitting = false;
  errorMessage = '';
  showDiscardConfirm = false;

  // ----- Touched flags (gate inline errors for non-InlineValidator fields) -----
  photoTouched = false;
  ingredientsTouched = false;
  stepsTouched = false;

  private isPositiveOrEmpty(value: number | null): boolean {
    return value === null || (typeof value === 'number' && !isNaN(value) && value > 0);
  }

  get hasValidIngredient(): boolean {
    return this.ingredients.some(i => i.name.trim().length > 0);
  }

  get hasValidStep(): boolean {
    return this.steps.some(s => s.description.trim().length > 0);
  }

  get showPhotoError(): boolean {
    return this.photoTouched && !this.heroFile;
  }

  get showIngredientsError(): boolean {
    return this.ingredientsTouched && !this.hasValidIngredient;
  }

  get showStepsError(): boolean {
    return this.stepsTouched && !this.hasValidStep;
  }

  get isFormValid(): boolean {
    return (
      this.title.trim().length > 0 &&
      this.description.trim().length > 0 &&
      !!this.heroFile &&
      !!this.difficulty &&
      this.hasValidIngredient &&
      this.hasValidStep &&
      this.isPositiveOrEmpty(this.servings) &&
      this.isPositiveOrEmpty(this.prepTime) &&
      this.isPositiveOrEmpty(this.cookTime)
    );
  }

  private emptyIngredient(): IngredientForm {
    return { name: '', quantity: null, unit: '' };
  }

  private emptyStep(): StepForm {
    return { description: '' };
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

  selectServeStyle(style: ServeStyle): void {
    this.selectedServeStyle = style;
  }

  addIngredient(): void {
    this.ingredients.push(this.emptyIngredient());
  }

  removeIngredient(index: number): void {
    if (this.ingredients.length === 1) return;
    this.ingredients.splice(index, 1);
  }

  addTool(): void {
    this.tools.push({ name: '' });
  }

  removeTool(index: number): void {
    this.tools.splice(index, 1);
  }

  addStep(): void {
    this.steps.push(this.emptyStep());
  }

  removeStep(index: number): void {
    if (this.steps.length === 1) return;
    this.steps.splice(index, 1);
  }

  get hasUnsavedContent(): boolean {
    return (
      this.title.trim().length > 0 ||
      this.description.trim().length > 0 ||
      this.heroFile !== null ||
      this.ingredients.some(i => i.name.trim().length > 0) ||
      this.tools.some(t => t.name.trim().length > 0) ||
      this.steps.some(s => s.description.trim().length > 0)
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
    this.servings = null;
    this.prepTime = null;
    this.cookTime = null;
    this.difficulty = '';
    this.ingredients = [this.emptyIngredient()];
    this.tools = [];
    this.steps = [this.emptyStep()];
    this.selectedServeStyle = 'HOT';
    this.errorMessage = '';
    this.photoTouched = false;
    this.ingredientsTouched = false;
    this.stepsTouched = false;
    this.validator.clearAll();
  }

  submitRecipe(): void {
    if (this.isSubmitting) return;

    this.photoTouched = true;
    this.ingredientsTouched = true;
    this.stepsTouched = true;
    this.validator.validateAll();

    if (!this.isFormValid || !this.heroFile) {
      this.errorMessage = 'Please complete all required fields correctly.';
      return;
    }

    const validIngredients = this.ingredients.filter(i => i.name.trim().length > 0);
    const validSteps = this.steps.filter(s => s.description.trim().length > 0);

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
            cookTime: this.cookTime,
            difficulty: this.difficulty || 'EASY',
            tags: this.selectedServeStyle ? [this.selectedServeStyle] : [],
          }),
        );
        formData.append(
          'ingredients',
          JSON.stringify(
            validIngredients.map(i => ({
              name: i.name.trim(),
              quantity: i.quantity ?? 0,
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
            validSteps.map((s, idx) => ({
              order: idx + 1,
              title: `Step ${idx + 1}`,
              description: s.description.trim(),
            })),
          ),
        );

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

