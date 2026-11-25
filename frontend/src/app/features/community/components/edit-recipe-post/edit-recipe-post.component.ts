import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EditRecipeModalComponent } from '../../../content/components/edit-recipe-modal/edit-recipe-modal.component';
import { Recipe } from '../../../../shared/models/recipe.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { CommunityService } from '../../services/community.service';

/**
 * Edit a community recipe post: loads the recipe behind the post and opens the shared recipe editor.
 * Saving updates the recipe and, on the server, the post's caption, cover, base and product tags.
 * Dùng: <app-edit-recipe-post [postId]="id" (saved)="reload($event)" (closed)="close()" />
 */
@Component({
  selector: 'app-edit-recipe-post',
  standalone: true,
  imports: [CommonModule, EditRecipeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-edit-recipe-modal *ngIf="recipe" [recipe]="recipe" [baseHint]="baseHint"
      (closed)="closed.emit()" (saved)="saved.emit(postId)"></app-edit-recipe-modal>
  `,
})
export class EditRecipePostComponent implements OnInit {
  private communityService = inject(CommunityService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  @Input({ required: true }) postId!: string;
  @Output() saved = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  recipe: Recipe | null = null;
  baseHint = '';

  ngOnInit(): void {
    this.communityService.getPostById(this.postId).subscribe({
      next: post => {
        if (!post.recipe) {
          this.toast.error('This recipe can no longer be edited.');
          this.closed.emit();
          return;
        }
        // The post carries the recipe document as stored; the editor reads the same fields.
        this.recipe = post.recipe as unknown as Recipe;
        const base = String(post.recipe.metadata?.base || post.base || '').toLowerCase();
        this.baseHint = ['matcha', 'coffee', 'others'].includes(base) ? base : '';
        this.cdr.markForCheck();
      },
      error: () => {
        this.toast.error('Could not load this recipe. Please try again.');
        this.closed.emit();
      },
    });
  }
}
