import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideX, LucideImage, LucideTrash2 } from '@lucide/angular';

import { CloudinaryService, CloudinaryUploadResult } from '../../services/cloudinary.service';
import { CommunityService } from '../../services/community.service';

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
  imports: [CommonModule, FormsModule, LucideX, LucideImage, LucideTrash2],
  templateUrl: './create-post-modal.component.html',
  styleUrls: ['./create-post-modal.component.scss'],
})
export class CreatePostModalComponent {
  private cloudinary = inject(CloudinaryService);
  private communityService = inject(CommunityService);
  private router = inject(Router);

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
  readonly baseOptions: BaseValue[] = ['COFFEE', 'MATCHA'];

  // ----- State modal Discard confirm -----
  showDiscardConfirm = false;

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
    const room = this.maxFiles - this.files.length;
    const toAdd = incoming.slice(0, Math.max(room, 0));

    for (const file of toAdd) {
      this.files.push(file);
      this.previews.push({
        url: URL.createObjectURL(file),
        type: file.type.startsWith('video') ? 'video' : 'image',
      });
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

  // ================== Đóng modal / Discard confirm ==================

  get hasUnsavedContent(): boolean {
    return (
      this.content.trim().length > 0 ||
      this.tags.length > 0 ||
      this.files.length > 0
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
    this.content = '';
    this.tagInput = '';
    this.tags = [];
    this.previews.forEach(p => URL.revokeObjectURL(p.url));
    this.previews = [];
    this.files = [];
    this.errorMessage = '';
  }

  // ================== Submit ==================

  submitPost(): void {
    if (this.isSubmitting) return;

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
    const hashtags = this.tags
      .filter(t => !t.isBase)
      .map(t => `#${t.label}`)
      .join(' ');
    const finalContent = hashtags ? `${this.content.trim()} ${hashtags}`.trim() : this.content.trim();
    const base = baseTag.label.toUpperCase() as BaseValue;

    const afterUpload = (media: CloudinaryUploadResult[]) => {
      const formData = new FormData();
      formData.append('content', finalContent);
      formData.append('base', base);
      formData.append('media', JSON.stringify(media));

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
        error: () => {
          this.isSubmitting = false;
          this.errorMessage = 'Failed to create post, please try again.';
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