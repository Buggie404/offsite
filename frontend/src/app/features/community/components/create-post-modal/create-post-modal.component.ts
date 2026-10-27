import { Component, DestroyRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import {
  LucideX, LucideImage, LucideTrash2, LucideSearch, LucideSparkles, LucideRefreshCw, LucidePlus, LucideCheck
} from '@lucide/angular';

import { CloudinaryService, CloudinaryUploadResult } from '../../services/cloudinary.service';
import { CommunityService } from '../../services/community.service';
import { Post, ProductTag } from '../../models/post.model';

// base chỉ có 2 giá trị hợp lệ theo Post model
const VALID_BASES = ['coffee', 'matcha'] as const;
type BaseValue = 'COFFEE' | 'MATCHA';

interface TagChip {
  label: string;   // "coffee"/"matcha" (base) hoặc "icedlatte" (hashtag tự do)
  isBase: boolean;
}

interface MediaPreview {
  url: string;
  type: 'image' | 'video';
}

// Backend có thể trả thêm sku cho từng sản phẩm (ô tìm theo tên hoặc SKU)
type ProductOption = ProductTag & { sku?: string | null };

@Component({
  selector: 'app-create-post-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideX, LucideImage, LucideTrash2, LucideSearch, LucideSparkles, LucideRefreshCw, LucidePlus, LucideCheck
  ],
  templateUrl: './create-post-modal.component.html',
  styleUrls: ['./create-post-modal.component.scss'],
})
export class CreatePostModalComponent implements OnInit, OnDestroy {
  private cloudinary = inject(CloudinaryService);
  private communityService = inject(CommunityService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  // Khớp với feed.component.html: (close)="closeCreatePost()"
  @Output() close = new EventEmitter<void>();

  // Có post truyền vào = chế độ sửa bài
  @Input() post: Post | null = null;
  @Output() saved = new EventEmitter<string>(); // post_id vừa sửa xong

  get isEdit(): boolean {
    return !!this.post;
  }

  // ----- State bài viết -----
  content = '';
  tagInput = '';
  tags: TagChip[] = [];
  files: File[] = [];
  previews: MediaPreview[] = []; // object URL (hoặc url Cloudinary khi sửa bài)
  activeIndex = 0;               // ảnh/video đang hiện ở khung lớn
  isSubmitting = false;
  errorMessage = '';

  readonly maxFiles = 4;
  readonly maxImageMb = 10;
  readonly maxVideoMb = 50;
  readonly baseOptions: BaseValue[] = ['COFFEE', 'MATCHA'];

  // ----- Gắn sản phẩm: thủ công (selectedProducts) và do AI gợi ý (aiProducts) -----
  // Cả hai cộng lại tối đa 3. AI không bao giờ chiếm chỗ của thẻ tự tag.
  readonly maxProducts = 3;
  selectedProducts: ProductOption[] = [];
  aiProducts: ProductOption[] = [];
  productQuery = '';
  searchResults: ProductOption[] = [];
  searching = false;
  searchDone = false;
  private query$ = new Subject<string>();

  // ----- Gợi ý AI — "Suggest again" tối đa 2 lần -----
  readonly maxRegenerate = 2;
  suggestLoading = false;
  hasSuggested = false;
  regenCount = 0;
  suggestMessage = '';
  private shownSuggestionIds = new Set<number>();
  private autoSuggest$ = new Subject<void>();

  private initialSnapshot = '';

  // ----- Discard confirm -----
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
          this.searchResults = results as ProductOption[];
          this.searchDone = true;
        }
        this.searching = false;
      });

    // Tự gợi ý một lần sau khi người dùng dừng gõ ~1.5s (chỉ lần đầu, chỉ khi tạo bài mới)
    this.autoSuggest$
      .pipe(debounceTime(1500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.isEdit && !this.hasSuggested && !this.suggestLoading && this.content.trim().length >= 8) {
          this.requestSuggestions(false);
        }
      });
  }

  ngOnInit(): void {
    const p = this.post;
    if (!p) return;

    const tagRe = /#[^\s#]+/g;
    const hashtags = (p.content?.match(tagRe) || []).map(t => t.slice(1));
    this.content = (p.content || '').replace(tagRe, '').replace(/[ \t]{2,}/g, ' ').trim();

    this.tags = [];
    if (p.base === 'COFFEE' || p.base === 'MATCHA') {
      this.tags.push({ label: p.base.toLowerCase(), isBase: true });
    }
    hashtags.forEach(h => this.tags.push({ label: h, isBase: false }));

    this.selectedProducts = (p.products || []).map(c => ({
      product_id: c.product_id,
      name: c.name,
      image_url: c.image_url,
      source: 'manual' as const,
      confidence: null,
    }));

    // Ảnh/video giữ nguyên khi sửa, chỉ để xem
    this.previews = (p.media || []).map(m => ({ url: m.url, type: m.type }));

    this.initialSnapshot = this.snapshot();
  }

  ngOnDestroy(): void {
    this.previews.forEach(p => URL.revokeObjectURL(p.url));
  }

  private snapshot(): string {
    return JSON.stringify([
      this.content.trim(),
      this.tags.map(t => t.label),
      this.selectedProducts.map(s => s.product_id),
      this.aiProducts.map(s => s.product_id),
    ]);
  }

  // Esc: đang mở hộp discard thì quay lại soạn bài, ngược lại thử đóng modal
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showDiscardConfirm) this.onKeepEditing();
    else this.onRequestClose();
  }

  // ================== Content ==================

  onContentChange(value: string): void {
    this.content = value;
    this.autoSuggest$.next();
  }

  // ================== Tags ==================

  get hashtags(): TagChip[] {
    return this.tags.filter(t => !t.isBase);
  }

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
      const exists = this.tags.some(t => !t.isBase && t.label.toLowerCase() === raw.toLowerCase());
      if (!exists) this.tags.push({ label: raw, isBase: false });
    }

    this.tagInput = '';
  }

  removeTag(tag: TagChip): void {
    this.tags = this.tags.filter(t => t !== tag);
  }

  get selectedBase(): BaseValue | null {
    const base = this.tags.find(t => t.isBase);
    return base ? (base.label.toUpperCase() as BaseValue) : null;
  }

  toggleBase(base: BaseValue): void {
    const label = base.toLowerCase();
    const already = this.tags.find(t => t.isBase && t.label.toLowerCase() === label);

    // Bấm lại vào base đang chọn -> bỏ chọn; ngược lại -> thay thế base cũ
    this.tags = this.tags.filter(t => !t.isBase);
    if (!already) this.tags.unshift({ label, isBase: true });
  }

  // ================== Photo & Media ==================

  get canAddMoreFiles(): boolean {
    return !this.isEdit && this.files.length < this.maxFiles;
  }

  get activePreview(): MediaPreview | null {
    return this.previews[this.activeIndex] ?? this.previews[0] ?? null;
  }

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
    if (this.isEdit) return;
    URL.revokeObjectURL(this.previews[index].url);
    this.files.splice(index, 1);
    this.previews.splice(index, 1);
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.previews.length - 1));
  }

  // ================== Gắn sản phẩm ==================

  get totalTagged(): number {
    return this.selectedProducts.length + this.aiProducts.length;
  }

  onProductQueryChange(value: string): void {
    this.productQuery = value;
    this.query$.next(value);
  }

  isManual(p: ProductTag): boolean {
    return this.selectedProducts.some(s => s.product_id === p.product_id);
  }

  isAi(p: ProductTag): boolean {
    return this.aiProducts.some(s => s.product_id === p.product_id);
  }

  isSelected(p: ProductTag): boolean {
    return this.isManual(p) || this.isAi(p);
  }

  // Bấm một dòng trong kết quả tìm: đang chọn thì bỏ, chưa chọn thì thêm (thẻ tự tag)
  toggleProduct(p: ProductOption): void {
    if (this.isManual(p)) {
      this.removeProduct(p);
      return;
    }
    if (this.isAi(p)) {
      this.removeAiProduct(p);
      return;
    }
    if (this.totalTagged >= this.maxProducts) {
      // Thẻ tự tag được ưu tiên: nhường chỗ bằng cách bỏ thẻ AI cuối cùng
      if (this.aiProducts.length) {
        this.aiProducts = this.aiProducts.slice(0, -1);
      } else {
        this.errorMessage = `You can tag up to ${this.maxProducts} products.`;
        return;
      }
    }
    this.errorMessage = '';
    this.selectedProducts = [...this.selectedProducts, { ...p, source: 'manual' }];
  }

  removeProduct(p: ProductTag): void {
    this.selectedProducts = this.selectedProducts.filter(s => s.product_id !== p.product_id);
    this.errorMessage = '';
  }

  removeAiProduct(p: ProductTag): void {
    this.aiProducts = this.aiProducts.filter(s => s.product_id !== p.product_id);
  }

  // ================== Gợi ý AI ==================

  get regenLeft(): number {
    return this.maxRegenerate - this.regenCount;
  }

  get canSuggest(): boolean {
    return !!this.content.trim() || !!this.selectedBase;
  }

  // content + hashtag — cùng định dạng sẽ gửi lên khi đăng
  private get composedContent(): string {
    const hashtags = this.hashtags.map(t => `#${t.label}`).join(' ');
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

    const slots = this.maxProducts - this.selectedProducts.length;
    if (slots <= 0) {
      this.suggestMessage = 'You have tagged 3 products. Remove one to see AI suggestions.';
      return;
    }

    this.suggestLoading = true;
    this.suggestMessage = '';

    // Loại những sản phẩm đã gợi ý hoặc đã tự tag để "Suggest again" ra kết quả khác
    const exclude = [
      ...new Set([...this.shownSuggestionIds, ...this.selectedProducts.map(p => p.product_id)]),
    ];

    this.communityService
      .suggestProducts({ content: this.composedContent, base: this.selectedBase, exclude })
      .subscribe({
        next: list => {
          this.suggestLoading = false;
          const fresh = (list as ProductOption[]).filter(p => !exclude.includes(p.product_id)).slice(0, slots);

          if (fresh.length === 0) {
            // Không còn gì mới: giữ nguyên kết quả cũ và KHÔNG tính vào lượt gợi ý lại
            this.suggestMessage = this.hasSuggested
              ? 'No other matches for this post.'
              : 'No matching products found. Try adding more detail or search manually.';
            this.hasSuggested = true;
            return;
          }

          this.aiProducts = fresh.map(p => ({ ...p, source: 'ai' as const }));
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

  // ================== Đóng modal / Discard confirm ==================

  get hasUnsavedContent(): boolean {
    if (this.isEdit) return this.snapshot() !== this.initialSnapshot;
    return (
      this.content.trim().length > 0 ||
      this.tags.length > 0 ||
      this.files.length > 0 ||
      this.selectedProducts.length > 0 ||
      this.aiProducts.length > 0
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
    this.activeIndex = 0;
    this.errorMessage = '';
    this.selectedProducts = [];
    this.aiProducts = [];
    this.productQuery = '';
    this.searchResults = [];
    this.searchDone = false;
    this.shownSuggestionIds.clear();
    this.hasSuggested = false;
    this.regenCount = 0;
    this.suggestMessage = '';
  }

  // ================== Submit ==================

  submitPost(): void {
    if (this.isSubmitting) return;

    // Người dùng gõ "coffee"/"#icedlatte" rồi bấm POST luôn mà chưa Enter -> vẫn nhận
    this.addTagFromInput();

    const baseTag = this.tags.find(t => t.isBase);
    if (!baseTag) {
      this.errorMessage = 'Please select a base tag (coffee or matcha).';
      return;
    }
    if (!this.content.trim() && this.files.length === 0 && !this.isEdit) {
      this.errorMessage = 'Add some content or media before posting.';
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    const finalContent = this.composedContent;
    const base = baseTag.label.toUpperCase() as BaseValue;
    // Thẻ tự tag trước, thẻ AI còn giữ sau; tổng tối đa 3
    const linkedProducts = [...this.selectedProducts, ...this.aiProducts]
      .slice(0, this.maxProducts)
      .map(p => p.product_id);

    const afterUpload = (media: CloudinaryUploadResult[]) => {
      if (this.post) {
        const editedId = this.post.post_id;
        this.communityService
          .updatePost(editedId, { content: finalContent, base, linked_products: JSON.stringify(linkedProducts) })
          .subscribe({
            next: () => {
              this.isSubmitting = false;
              this.saved.emit(editedId);
              this.close.emit();
            },
            error: err => {
              this.isSubmitting = false;
              this.errorMessage = err?.error?.error || 'Failed to update post, please try again.';
            },
          });
        return;
      }

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
