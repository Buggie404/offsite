import { Component, DestroyRef, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { LucideX, LucideSearch, LucideSparkles, LucideRefreshCw, LucidePlus } from '@lucide/angular';

import { ProductTag } from '../../models/post.model';
import { CommunityService } from '../../services/community.service';

/**
 * Chọn tối đa 3 sản phẩm để gắn vào bài: tìm thủ công + gợi ý theo nội dung ("Gợi ý lại" tối đa 2 lần).
 * Dùng: <app-product-picker [(selected)]="products" [suggestContent]="text" [suggestBase]="null" />
 */
@Component({
  selector: 'app-product-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX, LucideSearch, LucideSparkles, LucideRefreshCw, LucidePlus],
  templateUrl: './product-picker.component.html',
  styleUrls: ['./product-picker.component.scss'],
})
export class ProductPickerComponent {
  private communityService = inject(CommunityService);
  private destroyRef = inject(DestroyRef);

  @Input() selected: ProductTag[] = [];
  @Output() selectedChange = new EventEmitter<ProductTag[]>();

  /** Nội dung dùng để gợi ý (vd: tiêu đề + mô tả + nguyên liệu) */
  @Input() suggestContent = '';
  @Input() suggestBase: 'COFFEE' | 'MATCHA' | null = null;

  readonly maxProducts = 3;
  readonly maxRegenerate = 2;

  // ----- Tìm thủ công -----
  query = '';
  results: ProductTag[] = [];
  searching = false;
  searchDone = false;
  limitMessage = '';
  private query$ = new Subject<string>();

  // ----- Gợi ý -----
  suggestions: ProductTag[] = [];
  suggestLoading = false;
  hasSuggested = false;
  regenCount = 0;
  suggestMessage = '';
  private shownIds = new Set<number>();

  constructor() {
    this.query$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(q => {
          const ok = q.trim().length >= 2;
          this.searching = ok;
          this.searchDone = false;
          if (!ok) this.results = [];
        }),
        switchMap(q =>
          q.trim().length < 2
            ? of(null)
            : this.communityService.searchProducts(q.trim()).pipe(catchError(() => of([] as ProductTag[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(list => {
        if (list) {
          this.results = list;
          this.searchDone = true;
        }
        this.searching = false;
      });
  }

  get canAddMore(): boolean {
    return this.selected.length < this.maxProducts;
  }
  get regenLeft(): number {
    return this.maxRegenerate - this.regenCount;
  }
  get canSuggest(): boolean {
    return !!this.suggestContent.trim() || !!this.suggestBase;
  }
  get visibleResults(): ProductTag[] {
    return this.results.filter(p => !this.isSelected(p));
  }
  get visibleSuggestions(): ProductTag[] {
    return this.suggestions.filter(p => !this.isSelected(p));
  }

  isSelected(p: ProductTag): boolean {
    return this.selected.some(s => s.product_id === p.product_id);
  }

  onQueryChange(value: string): void {
    this.query = value;
    this.query$.next(value);
  }

  add(p: ProductTag): void {
    if (this.isSelected(p)) return;
    if (!this.canAddMore) {
      this.limitMessage = `You can tag up to ${this.maxProducts} products.`;
      return;
    }
    this.limitMessage = '';
    this.selectedChange.emit([...this.selected, p]);
  }

  remove(p: ProductTag): void {
    this.limitMessage = '';
    this.selectedChange.emit(this.selected.filter(s => s.product_id !== p.product_id));
  }

  requestSuggestions(isRegenerate = false): void {
    if (this.suggestLoading) return;
    if (isRegenerate && this.regenLeft <= 0) return;
    if (!this.canSuggest) {
      this.suggestMessage = 'Write something first so we can suggest products.';
      return;
    }

    this.suggestLoading = true;
    this.suggestMessage = '';
    const exclude = [...new Set([...this.shownIds, ...this.selected.map(p => p.product_id)])];

    this.communityService
      .suggestProducts({ content: this.suggestContent.trim(), base: this.suggestBase, exclude })
      .subscribe({
        next: list => {
          this.suggestLoading = false;
          const fresh = list.filter(p => !exclude.includes(p.product_id)).slice(0, this.maxProducts);
          if (fresh.length === 0) {
            // Không còn gợi ý mới: giữ kết quả cũ, không trừ lượt "Gợi ý lại"
            this.suggestMessage = this.hasSuggested
              ? 'No other matches.'
              : 'No matching products found. Try searching manually.';
            this.hasSuggested = true;
            return;
          }
          this.suggestions = fresh;
          fresh.forEach(p => this.shownIds.add(p.product_id));
          if (isRegenerate) this.regenCount++;
          this.hasSuggested = true;
        },
        error: () => {
          this.suggestLoading = false;
          this.suggestMessage = 'Could not load suggestions, please try again.';
        },
      });
  }

  /** Cha gọi khi reset form */
  reset(): void {
    this.query = '';
    this.results = [];
    this.searchDone = false;
    this.suggestions = [];
    this.shownIds.clear();
    this.hasSuggested = false;
    this.regenCount = 0;
    this.suggestMessage = '';
    this.limitMessage = '';
  }
}
