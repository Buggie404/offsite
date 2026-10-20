import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { Post, PostProductCard, postProductLink } from '../../models/post.model';
import { CommunityService } from '../../services/community.service';
import { CommentSectionComponent } from '../../components/comment-section/comment-section.component';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { AuthService } from '../../../../core/auth.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { ReportPostModalComponent, ReportPayload } from '../../components/report-post-modal/report-post-modal.component';
import {
  LucideArrowLeft, LucideArrowRight, LucideBookmark, LucideClock, LucideEllipsis, LucideFlag,
  LucideHeart, LucideMessageCircle, LucidePlay, LucideShare2, LucideStar, LucideTrash2, LucideUser
} from '@lucide/angular';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, CommentSectionComponent, ShareModalComponent, ConfirmationModalComponent,
    ReportPostModalComponent, LucideArrowLeft, LucideArrowRight, LucideBookmark, LucideClock, LucideEllipsis, LucideFlag,
    LucideHeart, LucideMessageCircle, LucidePlay, LucideShare2, LucideStar, LucideTrash2, LucideUser
  ],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.scss']
})
export class PostDetailComponent implements OnInit, OnDestroy {

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communityService = inject(CommunityService);
  private cdr = inject(ChangeDetectorRef);
  private authService = inject(AuthService);
  private toast = inject(ToastService);

  post: Post | null = null;
  loading = true;
  error: string | null = null;
  postLiked = false;
  postSaved = false;
  showShareModal = false;

  postContentParts: { text: string; isTag: boolean }[] = [];
  activeMediaIndex = 0;
  private timeTickHandle?: ReturnType<typeof setInterval>;

  // Variables for Deleting Post
  showPostOptions = false;
  isConfirmModalOpen = false;

  showReportModal = false;
  reportSubmitting = false;

  private static readonly TAG_LABELS: Record<string, string> = {
    HOT: 'Hot', COLD: 'Iced', DESSERT: 'Dessert', COCKTAIL: 'Cocktail'
  };

  get isRecipe(): boolean {
    return this.post?.post_type === 'recipe' && !!this.post.recipe;
  }

  get productCards(): PostProductCard[] {
    return (this.post?.products || []).slice(0, 3);
  }

  productLink(product: PostProductCard): string[] {
    return postProductLink(product);
  }

  // Hidden posts are only served to their owner, who sees a notice banner.
  get isHiddenPost(): boolean {
    return this.post?.status === 'hidden';
  }

  get activeMedia() {
    return this.mediaList[this.activeMediaIndex] ?? null;
  }

  // "Matcha · Iced" line under the RECIPE chip.
  get recipeKicker(): string {
    // The RECIPE chip already says "Recipe", so only matcha/coffee bases are repeated here.
    const rawBase = this.post?.base && this.post.base !== 'RECIPE' ? this.post.base : '';
    const base = rawBase ? rawBase.charAt(0) + rawBase.slice(1).toLowerCase() : '';
    const tags = (this.post?.recipe?.metadata?.tags || []).map(t => PostDetailComponent.TAG_LABELS[t] || t);
    return [base, ...tags].filter(Boolean).join(' · ');
  }

  get totalMinutes(): number {
    const meta = this.post?.recipe?.metadata;
    return (meta?.prepTime || 0) + (meta?.cookTime || 0);
  }

  // Short single-line captions read as a title (Figma "Sunday iced oat matcha"); long ones as body text.
  get isShortCaption(): boolean {
    const text = this.post?.content || '';
    return text.length <= 80 && !text.includes('\n');
  }

  initials(username: string): string {
    return (username || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
  }

  avatarTone(username: string): 'sage' | 'pink' {
    let sum = 0;
    for (let i = 0; i < (username || '').length; i++) sum += username.charCodeAt(i);
    return sum % 2 === 0 ? 'sage' : 'pink';
  }

  formatTimer(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onMenuSave(): void {
    this.showPostOptions = false;
    this.savePost();
  }

  openReport(): void {
    this.showPostOptions = false;
    this.showReportModal = true;
  }

  closeReport(): void {
    if (!this.reportSubmitting) this.showReportModal = false;
  }

  submitReport(payload: ReportPayload): void {
    if (!this.post || this.reportSubmitting) return;
    this.reportSubmitting = true;
    this.communityService.reportPost(this.post.post_id, payload.reason, payload.note).subscribe({
      next: () => {
        this.reportSubmitting = false;
        this.showReportModal = false;
        this.toast.success('Thanks for letting us know. We will review this post.');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.reportSubmitting = false;
        this.showReportModal = false;
        this.toast.error(err?.error?.error || 'Failed to submit report. Please try again.');
        this.cdr.markForCheck();
      }
    });
  }

  get deleteModalTitle(): string {
    return this.post?.post_type === 'recipe' ? 'Delete Recipe?' : 'Delete Post?';
  }

  get deleteModalMessage(): string {
    return this.post?.post_type === 'recipe' 
      ? 'Are you sure you want to delete this recipe?' 
      : 'Are you sure you want to delete this post?';
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'Post not found.';
      this.loading = false;
      return;
    }
    this.loadPost(id);
    this.timeTickHandle = setInterval(() => this.cdr.markForCheck(), 30000);
  }

  ngOnDestroy(): void {
    if (this.timeTickHandle) clearInterval(this.timeTickHandle);
  }

  loadPost(id: string): void {
    this.loading = true;
    this.error = null;
    this.communityService.getPostById(id).subscribe({
      next: (post) => {
        this.post = post;
        this.postLiked = post.liked ?? false;
        this.postSaved = post.saved ?? false;
        this.postContentParts = this.parseContentTags(post.content);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (err?.status === 404) {
          void this.router.navigateByUrl('/404', { skipLocationChange: true });
        } else {
          this.error = 'Failed to load this post. Please try again.';
          this.loading = false;
          this.cdr.markForCheck();
        }
      }
    });
  }

  get isPostAuthor(): boolean {
    const currentUser = this.authService.getUser();
    if (!currentUser || !this.post) return false;
    return currentUser.user_id === this.post.user_id;
  }

  togglePostOptions(event: Event): void {
    event.stopPropagation();
    this.showPostOptions = !this.showPostOptions;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.post-options')) {
      this.showPostOptions = false;
    }
  }

  promptDeletePost(): void {
    this.showPostOptions = false;
    this.isConfirmModalOpen = true;
  }

  cancelDeletePost(): void {
    this.isConfirmModalOpen = false;
  }

  confirmDeletePost(): void {
    if (!this.post) return;
    this.isConfirmModalOpen = false;
    this.loading = true;

    this.communityService.deletePost(this.post.post_id).subscribe({
      next: () => {
        this.router.navigate(['/community']);
      },
      error: (err) => {
        console.error('Failed to delete post:', err);
        this.loading = false;
        alert('Failed to delete this post. Please try again.');
        this.cdr.markForCheck();
      }
    });
  }

  // ── Media carousel ──
  get mediaList() { return this.post?.media || []; }

  setActiveMedia(index: number): void { this.activeMediaIndex = index; }


  // ── Like / Save post ──
  likePost(): void {
    if (!this.post) return;
    this.communityService.likePost(this.post.post_id).subscribe(res => {
      if (this.post) {
        this.post.like_count = res.like_count;
        this.postLiked = res.liked;
        this.cdr.markForCheck();
      }
    });
  }

  savePost(): void {
    if (!this.post) return;
    this.communityService.savePost(this.post.post_id).subscribe({
      next: (res) => {
        if (this.post) {
          this.post.saved = res.saved;
          this.post.save_count = res.save_count;
          this.postSaved = res.saved;
          this.cdr.markForCheck();
        }
      },
      error: (err) => console.error('Failed to save post:', err)
    });
  }

  scrollToComments(): void {
    document.getElementById('comments-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  sharePost(): void {
    this.showShareModal = true;
    if (!this.post) return;
    this.communityService.sharePost(this.post.post_id).subscribe({
      next: (res) => {
        if (this.post) {
          this.post.share_count = res.share_count;
          this.cdr.markForCheck();
        }
      },
      error: (err) => console.error('Failed to record share:', err)
    });
  }

  closeShareModal(): void { this.showShareModal = false; }
  get shareUrl(): string { return window.location.href; }

  onCommentCountChange(total: number): void {
    if (this.post) {
      this.post.comment_count = total;
      this.cdr.markForCheck();
    }
  }

  parseContentTags(content: string): { text: string; isTag: boolean }[] {
    if (!content) return [];
    return content
      .split(/(#[^\s#]+)/g)
      .filter(part => part.length > 0)
      .map(part => ({ text: part, isTag: part.startsWith('#') }));
  }

  timeAgo(dateStr: string): string {
    const created = new Date(dateStr).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - created);
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (minutes < 1) return 'JUST NOW';
    if (minutes < 60) return `${minutes}M AGO`;
    if (hours < 24) return `${hours}H AGO`;
    return `${days}D AGO`;
  }

  goBack(): void {
    this.router.navigate(['/community']);
  }
}


