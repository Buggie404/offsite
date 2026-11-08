import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideCheck,
  LucideChevronDown,
  LucideEye,
  LucideEyeOff,
  LucideLock,
  LucidePlus,
  LucideSearch,
  LucideTrash2,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';
import { AdminRecipeRow, AdminRecipeService, FeaturedSlot } from '../../services/admin-recipe.service';
import {
  NOTE_MAX,
  RecipeModerationReason,
  notePlaceholder,
  noteRequired,
  reasonsFor
} from '../../constants/recipe-moderation-reasons';

type SourceFilter = 'all' | 'offsite' | 'community';
type LinkedFilter = 'all' | 'linked' | 'not_linked';
type VisibilityFilter = 'all' | 'published' | 'hidden' | 'resubmitted' | 'deleted';
type RecipeModalKind = 'hide' | 'show' | 'delete' | 'feature';

function rowStatus(row: AdminRecipeRow): VisibilityFilter | 'hidden_final' {
  if (row.deleted || row.moderation_status === 'deleted') return 'deleted';
  if (row.moderation_status === 'resubmitted') return 'resubmitted';
  if (row.moderation_status === 'hidden_final') return 'hidden_final';
  if (row.moderation_status === 'hidden' || !row.published) return 'hidden';
  return 'published';
}

interface RecipeModal {
  kind: RecipeModalKind;
  row: AdminRecipeRow;
}

interface FeaturedToast {
  message: string;
  recipeId: string;
  previous: boolean;
}

@Component({
  selector: 'app-admin-recipes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideSearch,
    LucideChevronDown,
    LucidePlus,
    LucideEye,
    LucideEyeOff,
    LucideLock,
    LucideCheck,
    LucideTrash2,
    LucideX,
    LucideTriangleAlert
  ],
  templateUrl: './recipes.component.html',
  styleUrl: './recipes.component.scss'
})
export class AdminRecipesComponent implements OnInit {
  private recipesApi = inject(AdminRecipeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  rows: AdminRecipeRow[] = [];
  featuredSlots: FeaturedSlot[] = [];
  query = '';
  source: SourceFilter = 'all';
  linked: LinkedFilter = 'all';
  visibility: VisibilityFilter = 'all';
  savingId: string | null = null;
  toast: FeaturedToast | null = null;
  modal: RecipeModal | null = null;
  modalError = '';
  savingModal = false;
  note = '';
  reason = '';
  replaceId = '';
  readonly noteMax = NOTE_MAX;

  readonly sources: { value: SourceFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'offsite', label: 'Offsite' },
    { value: 'community', label: 'Community' }
  ];

  readonly links: { value: LinkedFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'linked', label: 'Linked' },
    { value: 'not_linked', label: 'Not linked' }
  ];

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.query = params.get('search') || '';
    });
    this.recipesApi.list().subscribe({
      next: (response) => {
        this.rows = response.data || [];
        this.featuredSlots = response.featured_recipes || [];
        this.featuredLimit = response.featured_limit || 10;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not load recipes.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  get onRecipesPage(): number {
    return this.rows.filter((row) => rowStatus(row) === 'published').length;
  }

  get featuredCount(): number {
    return this.rows.filter((row) => rowStatus(row) === 'published' && row.featured).length;
  }

  featuredLimit = 10;

  get summary(): string {
    const recipes = `${this.onRecipesPage} recipe${this.onRecipesPage === 1 ? '' : 's'} on the Recipes page`;
    return `${recipes} · ${this.featuredCount} of ${this.featuredLimit} featured on homepage`;
  }

  get visibleRows(): AdminRecipeRow[] {
    const query = this.query.trim().toLowerCase();
    return this.rows.filter((row) => {
      if (this.source !== 'all' && row.source !== this.source) return false;
      if (this.linked === 'linked' && row.linked !== 'linked') return false;
      if (this.linked === 'not_linked' && row.linked !== 'not_linked') return false;
      const status = rowStatus(row);
      if (this.visibility === 'published' && status !== 'published') return false;
      if (this.visibility === 'hidden' && status !== 'hidden' && status !== 'hidden_final') return false;
      if (this.visibility === 'resubmitted' && status !== 'resubmitted') return false;
      if (this.visibility === 'deleted' && status !== 'deleted') return false;
      if (!query) return true;
      return row.title.toLowerCase().includes(query) || row.author_line.toLowerCase().includes(query);
    });
  }

  statusLabel(row: AdminRecipeRow): string {
    const status = rowStatus(row);
    if (status === 'deleted') return 'Deleted';
    if (status === 'resubmitted') return 'Resubmitted';
    if (status === 'hidden_final') return 'Final reject';
    if (status === 'hidden') return 'Hidden';
    return 'Published';
  }

  statusClass(row: AdminRecipeRow): string {
    const status = rowStatus(row);
    if (status === 'deleted') return 'chip--deleted';
    if (status === 'resubmitted') return 'chip--resubmitted';
    if (status === 'hidden' || status === 'hidden_final') return 'chip--hidden';
    return '';
  }

  isDeleted(row: AdminRecipeRow): boolean {
    return rowStatus(row) === 'deleted';
  }

  isPublished(row: AdminRecipeRow): boolean {
    return rowStatus(row) === 'published';
  }

  get reasonOptions(): RecipeModerationReason[] {
    if (!this.modal || this.modal.kind === 'show' || this.modal.kind === 'feature') return [];
    return reasonsFor(this.modal.kind, this.modal.row.source);
  }

  get noteNeedsValue(): boolean {
    return noteRequired(this.reason);
  }

  get noteFieldPlaceholder(): string {
    if (this.modal?.row.source === 'community') {
      if (this.reason === 'low_quality') {
        return 'Say what needs fixing — this is sent to the owner';
      }
      return this.noteNeedsValue
        ? 'Required note — sent to the owner'
        : 'Optional note — sent to the owner with the reason';
    }
    return notePlaceholder(this.reason);
  }

  createRecipe(): void {
    void this.router.navigate(['/admin/recipes/new']);
  }

  openRecipe(row: AdminRecipeRow, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, label')) return;
    void this.router.navigate(['/admin/recipes', row.recipe_id]);
  }

  onSearch(value: string): void {
    this.query = value;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: value.trim() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  setFeatured(row: AdminRecipeRow, featured: boolean): void {
    if (this.savingId || this.savingModal || this.modal || row.featured === featured || !this.isPublished(row)) return;
    if (featured && this.featuredCount >= this.featuredLimit) {
      this.openModal('feature', row);
      return;
    }
    this.commitFeatured(row, featured);
  }

  undoFeatured(): void {
    const toast = this.toast;
    if (!toast) return;
    const row = this.rows.find((item) => item.recipe_id === toast.recipeId);
    this.dismissToast();
    if (row) this.setFeatured(row, toast.previous);
  }

  onEye(row: AdminRecipeRow): void {
    if (this.isDeleted(row)) return;
    this.openModal(this.isPublished(row) ? 'hide' : 'show', row);
  }

  onTrash(row: AdminRecipeRow): void {
    if (this.isDeleted(row)) return;
    this.openModal('delete', row);
  }

  onReasonChange(reason: string): void {
    this.reason = reason;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modal && !this.savingModal) this.closeModal();
  }

  closeModal(): void {
    if (this.savingModal) return;
    this.modal = null;
    this.modalError = '';
    this.replaceId = '';
  }

  get canConfirm(): boolean {
    if (!this.modal || this.savingModal) return false;
    if (this.modal.kind === 'show') return true;
    if (this.modal.kind === 'feature') {
      return this.featuredSlots.some((item) => item.recipe_id === this.replaceId);
    }
    if (!this.reasonOptions.some((item) => item.value === this.reason)) return false;
    if (this.noteNeedsValue && !this.note.trim()) return false;
    return this.note.trim().length <= this.noteMax;
  }

  get dangerModal(): boolean {
    return this.modal?.kind === 'delete';
  }

  get modalTitle(): string {
    const title = this.modal?.row.title || 'this recipe';
    if (this.modal?.kind === 'hide') return `Hide “${title}”?`;
    if (this.modal?.kind === 'show') return `Show “${title}” on the Recipes page?`;
    if (this.modal?.kind === 'feature') return `Feature “${title}” on the homepage?`;
    return `Delete “${title}”?`;
  }

  get confirmLabel(): string {
    if (this.savingModal) return 'Saving…';
    if (this.modal?.kind === 'hide') {
      return this.modal.row.source === 'community' ? 'Hide & notify' : 'Hide recipe';
    }
    if (this.modal?.kind === 'show') return 'Show recipe';
    if (this.modal?.kind === 'feature') return 'Replace & feature';
    return this.modal?.row.source === 'community' ? 'Delete & notify' : 'Delete recipe';
  }

  ownerHandle(row: AdminRecipeRow): string {
    const name = row.author_line.replace(/^@/, '').trim();
    return name ? `@${name}` : '';
  }

  confirmModal(): void {
    const modal = this.modal;
    if (!modal || this.savingModal || !this.canConfirm) return;
    this.savingModal = true;
    this.modalError = '';
    const note = this.note.trim();

    if (modal.kind === 'feature') {
      this.commitFeatured(modal.row, true, this.replaceId, true);
      return;
    }

    if (modal.kind === 'delete') {
      this.recipesApi.deleteRecipe(modal.row.recipe_id, { reason: this.reason, note }).subscribe({
        next: () => {
          this.replaceRow({
            ...modal.row,
            published: false,
            featured: false,
            deleted: true,
            moderation_status: 'deleted'
          });
          this.finishModal();
        },
        error: (error) => this.failModal(error)
      });
      return;
    }

    const body = modal.kind === 'hide' ? { reason: this.reason, note } : {};
    this.recipesApi.setVisibility(modal.row.recipe_id, modal.kind === 'show', body).subscribe({
      next: (response) => {
        this.replaceRow(response.data);
        this.finishModal();
      },
      error: (error) => this.failModal(error)
    });
  }

  linkedLabel(row: AdminRecipeRow): string {
    if (row.linked === 'linked') return `Linked · ${row.linked_count}`;
    return 'Not linked';
  }

  updatedLabel(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private commitFeatured(
    row: AdminRecipeRow,
    featured: boolean,
    replaceRecipeId?: string,
    fromModal = false
  ): void {
    const previous = row.featured;
    const replaceId = replaceRecipeId || '';
    this.savingId = row.recipe_id;
    this.error = '';
    if (!fromModal) row.featured = featured;
    this.recipesApi.setFeatured(row.recipe_id, featured, replaceId || null).subscribe({
      next: (response) => {
        if (replaceId) {
          const replaced = this.rows.find((item) => item.recipe_id === replaceId);
          if (replaced) this.replaceRow({ ...replaced, featured: false });
        }
        this.replaceRow(response.data);
        this.savingId = null;
        if (fromModal) this.finishModal();
        this.showToast(response.data, previous);
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (!fromModal) row.featured = previous;
        this.savingId = null;
        const message = error?.error?.error || `Could not update “${row.title}”.`;
        if (fromModal) {
          this.modalError = message;
          this.savingModal = false;
        } else {
          this.error = message;
        }
        this.cdr.markForCheck();
      }
    });
  }

  private replaceRow(next: AdminRecipeRow): void {
    const previous = this.rows.find((row) => row.recipe_id === next.recipe_id);
    // Soft-deleted recipes stay listed but sink to the bottom (matches admin API sort).
    if (next.deleted || next.moderation_status === 'deleted') {
      this.rows = [...this.rows.filter((row) => row.recipe_id !== next.recipe_id), next];
    } else {
      this.rows = this.rows.map((row) => row.recipe_id === next.recipe_id ? next : row);
    }
    if (!previous || previous.featured !== next.featured) this.syncFeaturedSlots(next);
  }

  private syncFeaturedSlots(next: AdminRecipeRow): void {
    if (next.featured) {
      if (this.featuredSlots.some((item) => item.recipe_id === next.recipe_id)) return;
      this.featuredSlots = [
        ...this.featuredSlots,
        { recipe_id: next.recipe_id, title: next.title, image_url: next.image_url }
      ].slice(0, this.featuredLimit);
      return;
    }
    this.featuredSlots = this.featuredSlots.filter((item) => item.recipe_id !== next.recipe_id);
  }

  private openModal(kind: RecipeModalKind, row: AdminRecipeRow): void {
    this.modal = { kind, row };
    this.modalError = '';
    this.note = '';
    this.replaceId = '';
    if (kind === 'feature' && this.featuredSlots.length < this.featuredLimit) {
      this.featuredSlots = this.rows
        .filter((item) => rowStatus(item) === 'published' && item.featured)
        .map((item) => ({
          recipe_id: item.recipe_id,
          title: item.title,
          image_url: item.image_url
        }));
    }
    const options = kind === 'show' || kind === 'feature' ? [] : reasonsFor(kind, row.source);
    this.reason = options[0]?.value || '';
  }

  private finishModal(): void {
    this.savingModal = false;
    this.modal = null;
    this.modalError = '';
    this.replaceId = '';
    this.cdr.markForCheck();
  }

  private failModal(error: { error?: { error?: string; data?: AdminRecipeRow } }): void {
    if (error?.error?.data?.recipe_id) this.replaceRow(error.error.data);
    this.modalError = error?.error?.error || 'Could not update this recipe.';
    this.savingModal = false;
    this.cdr.markForCheck();
  }

  private showToast(row: AdminRecipeRow, previous: boolean): void {
    this.toast = {
      recipeId: row.recipe_id,
      previous,
      message: row.featured
        ? `“${row.title}” is now on the homepage.`
        : `“${row.title}” was removed from the homepage.`
    };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.dismissToast();
      this.cdr.markForCheck();
    }, 6000);
  }

  private dismissToast(): void {
    this.toast = null;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }
}
