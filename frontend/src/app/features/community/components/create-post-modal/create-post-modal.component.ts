import { Component, DestroyRef, EventEmitter, HostListener, OnDestroy, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import {
  LucideX, LucideImage, LucideTrash2, LucideSearch, LucideSparkles, LucideRefreshCw, LucidePlus
} from '@lucide/angular';

import { CloudinaryService, CloudinaryUploadResult } from '../../services/cloudinary.service';
import { CommunityService } from '../../services/community.service';
import { ProductTag } from '../../models/post.model';

// base chỉ có 2 giá trị hợp lệ theo Post model — gõ 1 trong 2 từ này vào ô Tags
// sẽ được nhận là "base" (tag phân loại bắt buộc), khác đi thì thành hashtag tự do
const VALID_BASES = ['coffee', 'matcha'] as const;
type BaseValue = 'COFFEE' | 'MATCHA';

interface TagChip {
  label: string;   // hiển thị: "coffee"/"matcha" hoặc "icedcoffee" (hashtag tự do)
  isBase: boolean;
}

interface MediaPreview {
  url: string;
  type: 'image' | 'video';
}

@Component({
  selector: 'app-create-post-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideX, LucideImage, LucideTrash2, LucideSearch, LucideSparkles, LucideRefreshCw, LucidePlus
  ],
  templateUrl: './create-post-modal.component.html',
  styleUrls: ['./create-post-modal.component.scss'],
})
export class CreatePostModalComponent implements OnDestroy {
  private cloudinary = inject(CloudinaryService);
  private communityService = inject(CommunityService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  // Khớp với feed.component.html: (close)="closeCreatePost()"
  @Output() close = new EventEmitter<void>();

  // ----- State modal Create Post -----
  content = '';
  tagInput = '';
  tags: TagChip[] = [];
  files: File[] = [];
  previews: MediaPreview[] = []; // object URL + type để show thumbnail (ảnh hoặc video) trước khi upload
  isSubmitting = false;
  errorMessage = '';

  readonly maxFiles = 4;
  // Giới hạn dung lượng phía client (chỉnh theo preset Cloudinary của team nếu khác)
  readonly maxImageMb = 10;
  readonly maxVideoMb = 50;
  readonly baseOptions: BaseValue[] = ['COFFEE', 'MATCHA'];

  // ----- Gắn sản phẩm (tối đa 3) -----
  readonly maxProducts = 3;
  selectedProducts: ProductTag[] = [];
  productQuery = '';
  searchResults: ProductTag[] = [];
  searching = false;
  searchDone = false;
  private query$ = new Subject<string>();

  // ----- Gợi ý thẻ sản phẩm (AI) — "Gợi ý lại" tối đa 2 lần -----
  readonly maxRegenerate = 2;
  suggestions: ProductTag[] = [];
  suggestLoading = false;
  hasSuggested = false;
  regenCount = 0;
  suggestMessage = '';
  private shownSuggestionIds = new Set<number>();

  // ----- State modal Discard confirm -----
  showDiscardConfirm = false;

  constructor() {
    // Tìm sản phẩm thủ công: debounce 300ms, huỷ request cũ khi gõ tiếp
    this.query$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(q => {
          const ok = q.trim().length >= 2;
          this.searching = ok;
          this.searchDone = false;
          if (!ok) this.searchResults = [];
        }),
        switchMap(q =>
          q.trim().length < 2
            ? of(null)
            : this.communityService.searchProducts(q.trim()).pipe(catchError(() => of([] as ProductTag[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(results => {
        if (results) {
          this.searchResults = results;
          this.searchDone = true;
        }
        this.searching = false;
      });
  }

  ngOnDestroy(): void {
    this.previews.forEach(p => URL.revokeObjectURL(p.url));
  }

  // Esc: đang mở hộp discard thì quay lại soạn bài, ngược lại thử đóng modal
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showDiscardConfirm) this.onKeepEditing();
    else this.onRequestClose();
  }

  // ================== Tags ==================

  onTagInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addTagFromInput();
    }
  }

  addTagFromInput(): void {
    const raw = this.tagInput.trim().replace(/^#/, '');
    if (!raw) return;

    const isBase = (VALID_BASES as readonly string[]).includes(raw.toLowerCase());

    if (isBase) {
      // Chỉ cho phép 1 base tag — nếu đã có thì thay thế
      this.tags = this.tags.filter(t => !t.isBase);
      this.tags.unshift({ label: raw.toLowerCase(), isBase: true });
    } else {
      const exists = this.tags.some(
        t => !t.isBase && t.label.toLowerCase() === raw.toLowerCase(),
      );
      if (!exists) {
        this.tags.push({ label: raw, isBase: false });
      }
    }

    this.tagInput = '';
  }

  removeTag(tag: TagChip): void {
    this.tags = this.tags.filter(t => t !== tag);
  }

  // Chọn nhanh base tag (coffee/matcha) bằng nút bấm thay vì gõ tay
  get selectedBase(): BaseValue | null {
    const base = this.tags.find(t => t.isBase);
    return base ? (base.label.toUpperCase() as BaseValue) : null;
  }

  toggleBase(base: BaseValue): void {
    const label = base.toLowerCase();
    const already = this.tags.find(t => t.isBase && t.label.toLowerCase() === label);

    // Bấm lại vào base đang chọn -> bỏ chọn; ngược lại -> thay thế base cũ
    this.tags = this.tags.filter(t => !t.isBase);
    if (!already) {
      this.tags.unshift({ label, isBase: true });
    }
  }

  // ================== Photo & Media ==================

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const incoming = Array.from(input.files);
    const room = Math.max(this.maxFiles - this.files.length, 0);
    const rejected: string[] = [];
    const accepted: File[] = [];

    for (const file of incoming) {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const limitMb = isVideo ? this.maxVideoMb : this.maxImageMb;
      if (!isImage && !isVideo) {
        rejected.push(`${file.name} (unsupported type)`);
      } else if (file.size > limitMb * 1024 * 1024) {
        rejected.push(`${file.name} (over ${limitMb}MB)`);
      } else {
        accepted.push(file);
      }
    }

    for (const file of accepted.slice(0, room)) {
      this.files.push(file);
      this.previews.push({
        url: URL.createObjectURL(file),
        type: file.type.startsWith('video') ? 'video' : 'image',
      });
    }

    if (rejected.length) {
      this.errorMessage = `Skipped: ${rejected.join(', ')}`;
    } else if (accepted.length > room) {
      this.errorMessage = `You can add up to ${this.maxFiles} files.`;
    } else {
      this.errorMessage = '';
    }

    input.value = '';
  }

  removeFile(index: number): void {
    URL.revokeObjectURL(this.previews[index].url);
    this.files.splice(index, 1);
    this.previews.splice(index, 1);
  }

  get canAddMoreFiles(): boolean {
    return this.files.length < this.maxFiles;
  }

  // ================== Gắn sản phẩm thủ công ==================

  get canAddMoreProducts(): boolean {
    return this.selectedProducts.length < this.maxProducts;
  }

  onProductQueryChange(value: string): void {
    this.productQuery = value;
    this.query$.next(value);
  }

  isProductSelected(p: ProductTag): boolean {
    return this.selectedProducts.some(s => s.product_id === p.product_id);
  }

  addProduct(p: ProductTag): void {
    if (this.isProductSelected(p)) return;
    if (!this.canAddMoreProducts) {
      this.errorMessage = `You can tag up to ${this.maxProducts} products.`;
      return;
    }
    this.errorMessage = '';
    this.selectedProducts.push(p);
  }

  removeProduct(p: ProductTag): void {
    this.selectedProducts = this.selectedProducts.filter(s => s.product_id !== p.product_id);
    this.errorMessage = '';
  }

  // Kết quả tìm kiếm, bỏ những cái đã chọn
  get visibleSearchResults(): ProductTag[] {
    return this.searchResults.filter(p => !this.isProductSelected(p));
  }

  // ================== Gợi ý thẻ sản phẩm (AI) ==================

  get regenLeft(): number {
    return this.maxRegenerate - this.regenCount;
  }

  get canSuggest(): boolean {
    return !!this.content.trim() || !!this.selectedBase;
  }

  get visibleSuggestions(): ProductTag[] {
    return this.suggestions.filter(p => !this.isProductSelected(p));
  }

  // content + hashtag — cùng định dạng sẽ gửi lên khi đăng
  private get composedContent(): string {
    const hashtags = this.tags.filter(t => !t.isBase).map(t => `#${t.label}`).join(' ');
    const text = this.content.trim();
    return hashtags ? `${text} ${hashtags}`.trim() : text;
  }

  requestSuggestions(isRegenerate = false): void {
    if (this.suggestLoading) return;
    if (isRegenerate && this.regenLeft <= 0) return;
    if (!this.canSuggest) {
      this.suggestMessage = 'Write something or pick coffee/matcha first.';
      return;
    }

    this.suggestLoading = true;
    this.suggestMessage = '';

    // Loại những sản phẩm đã gợi ý/đã chọn để "Gợi ý lại" ra kết quả khác
    const exclude = [
      ...new Set([...this.shownSuggestionIds, ...this.selectedProducts.map(p => p.product_id)]),
    ];

    this.communityService
      .suggestProducts({ content: this.composedContent, base: this.selectedBase, exclude })
      .subscribe({
        next: list => {
          this.suggestLoading = false;
          const fresh = list
            .filter(p => !exclude.includes(p.product_id))
            .slice(0, this.maxProducts);

          if (fresh.length === 0) {
            // Không còn gì mới: giữ nguyên kết quả cũ và KHÔNG tính vào lượt gợi ý lại
            this.suggestMessage = this.hasSuggested
              ? 'No other matches for this post.'
              : 'No matching products found. Try adding more detail or search manually.';
            this.hasSuggested = true;
            return;
          }

          this.suggestions = fresh;
          fresh.forEach(p => this.shownSuggestionIds.add(p.product_id));
          if (isRegenerate) this.regenCount++;
          this.hasSuggested = true;
        },
        error: () => {
          this.suggestLoading = false;
          this.suggestMessage = 'Could not load suggestions, please try again.';
        },
      });
  }

  // ================== Preview ==================

  get showPreview(): boolean {
    return !!this.content.trim() || this.previews.length > 0;
  }

  get previewMedia(): MediaPreview | null {
    return this.previews[0] ?? null;
  }

  // ================== Đóng modal / Discard confirm ==================

  get hasUnsavedContent(): boolean {
    return (
      this.content.trim().length > 0 ||
      this.tags.length > 0 ||
      this.files.length > 0 ||
      this.selectedProducts.length > 0
    );
  }

  onRequestClose(): void {
    if (this.isSubmitting) return; // đang đăng thì không cho đóng
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
    this.content = '';
    this.tagInput = '';
    this.tags = [];
    this.previews.forEach(p => URL.revokeObjectURL(p.url));
    this.previews = [];
    this.files = [];
    this.errorMessage = '';
    this.selectedProducts = [];
    this.productQuery = '';
    this.searchResults = [];
    this.searchDone = false;
    this.suggestions = [];
    this.shownSuggestionIds.clear();
    this.hasSuggested = false;
    this.regenCount = 0;
    this.suggestMessage = '';
  }

  // ================== Submit ==================

  submitPost(): void {
    if (this.isSubmitting) return;

    // Người dùng gõ "coffee"/"#icedcoffee" rồi bấm POST luôn mà chưa Enter -> vẫn nhận
    this.addTagFromInput();

    const baseTag = this.tags.find(t => t.isBase);
    if (!baseTag) {
      this.errorMessage = 'Please select a base tag (coffee or matcha).';
      return;
    }
    if (!this.content.trim() && this.files.length === 0) {
      this.errorMessage = 'Add some content or media before posting.';
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    // Nối hashtag tự do vào cuối content (khớp cách post-detail parse hashtag)
    const finalContent = this.composedContent;
    const base = baseTag.label.toUpperCase() as BaseValue;
    const linkedProducts = this.selectedProducts.slice(0, this.maxProducts).map(p => p.product_id);

    const afterUpload = (media: CloudinaryUploadResult[]) => {
      const formData = new FormData();
      formData.append('content', finalContent);
      formData.append('base', base);
      formData.append('media', JSON.stringify(media));
      // Backend: parseLinkedProducts() nhận JSON string, tối đa 3 id
      formData.append('linked_products', JSON.stringify(linkedProducts));

      this.communityService.createPost(formData).subscribe({
        next: res => {
          this.isSubmitting = false;
          const postId = res?.data?.post_id;
          this.resetForm();
          this.close.emit();
          if (postId) {
            this.router.navigate(['/community/post', postId]);
          }
        },
        error: err => {
          this.isSubmitting = false;
          this.errorMessage = err?.error?.error || 'Failed to create post, please try again.';
        },
      });
    };

    if (this.files.length) {
      this.cloudinary.uploadMultiple(this.files).subscribe({
        next: media => afterUpload(media),
        error: () => {
          this.isSubmitting = false;
          this.errorMessage = 'Failed to upload media, please try again.';
        },
      });
    } else {
      afterUpload([]);
    }
  }
}
