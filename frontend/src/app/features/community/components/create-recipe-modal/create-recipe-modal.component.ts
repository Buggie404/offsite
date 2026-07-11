import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideX, LucideCamera, LucideCircleCheck, LucideTrash2 } from '@lucide/angular';

import { CloudinaryService } from '../../services/cloudinary.service';
import { RecipeService } from '../../../home/services/recipe.service';
import { Difficulty } from '../../../home/models/recipe.model';

type ServeStyle = 'HOT' | 'COLD' | 'DESSERT';

interface IngredientForm {
  name: string;
  quantity: number | null;
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
export class CreateRecipeModalComponent {
  private cloudinary = inject(CloudinaryService);
  private recipeService = inject(RecipeService);
  private router = inject(Router);

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

  private emptyIngredient(): IngredientForm {
    return { name: '', quantity: null };
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
    input.value = '';
  }

  removeHeroImage(): void {
    if (this.heroPreview) URL.revokeObjectURL(this.heroPreview);
    this.heroFile = null;
    this.heroPreview = null;
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
  }

  submitRecipe(): void {
    if (this.isSubmitting) return;

    const validIngredients = this.ingredients.filter(i => i.name.trim().length > 0);
    const validSteps = this.steps.filter(s => s.description.trim().length > 0);

    if (!this.title.trim()) {
      this.errorMessage = 'Please enter a recipe title.';
      return;
    }
    if (!this.heroFile) {
      this.errorMessage = 'Please add a cover photo for your recipe.';
      return;
    }
    if (validIngredients.length === 0) {
      this.errorMessage = 'At least one ingredient is required.';
      return;
    }
    if (validSteps.length === 0) {
      this.errorMessage = 'At least one step is required.';
      return;
    }

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
              unit: '',
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

