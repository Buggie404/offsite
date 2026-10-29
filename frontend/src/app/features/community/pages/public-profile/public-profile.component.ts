import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  LucideEllipsis,
  LucideFlag,
  LucidePencil,
  LucidePlus,
  LucideShare2,
  LucideTrash2,
  LucideUpload,
  LucideX,
} from '@lucide/angular';
import {
  CommunityService,
  EditableProfile,
  PublicProfile,
} from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Post } from '../../models/post.model';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import {
  ReportPostModalComponent,
  ReportPayload,
} from '../../components/report-post-modal/report-post-modal.component';
import { CloudinaryService } from '../../services/cloudinary.service';
import { PostCardComponent } from '../../components/post-card/post-card.component';
import { CreatePostModalComponent } from '../../components/create-post-modal/create-post-modal.component';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';

type ProfileTab = 'posts' | 'recipes';

const EMPTY_EDIT: EditableProfile = {
  profile_name: '',
  community_name: '',
  email: '',
  phone: '',
  avatar_url: '',
};

@Component({
  selector: 'app-public-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ShareModalComponent,
    ReportPostModalComponent,
    PostCardComponent,
    CreatePostModalComponent,
    ConfirmationModalComponent,
    LucideEllipsis,
    LucideFlag,
    LucidePencil,
    LucidePlus,
    LucideShare2,
    LucideTrash2,
    LucideUpload,
    LucideX,
  ],
  templateUrl: './public-profile.component.html',
  styleUrl: './public-profile.component.scss',
})
export class PublicProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private community = inject(CommunityService);
  private auth = inject(AuthService);
  private authModal = inject(AuthModalService);
  private toast = inject(ToastService);
  private cloudinary = inject(CloudinaryService);
  private cdr = inject(ChangeDetectorRef);
  private host = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);

  profile: PublicProfile | null = null;
  posts: Post[] = [];
  loading = true;
  notFound = false;
  followBusy = false;
  activeTab: ProfileTab = 'posts';

  // ── Profile menu + account-level modals ──
  menuOpen = false;
  shareOpen = false;
  reportOpen = false;
  reportSubmitting = false;

  // ── Edit profile modal ──
  editOpen = false;
  editSaving = false;
  avatarUploading = false;
  editError = '';
  edit: EditableProfile = { ...EMPTY_EDIT };

  // ── Post cards (same card + actions as the All Stories feed) ──
  currentUserId = computed<string | undefined>(() => this.auth.currentUser()?.user_id);
  postShareOpen = false;
  postShareUrl = '';
  reportingPostId: string | null = null;
  postReportSubmitting = false;
  pendingDeletePost: Post | null = null;
  editingPost: Post | null = null;
  editPostOpen = false;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('userId');
      if (id) this.load(id);
    });
  }

  get displayedPosts(): Post[] {
    return this.activeTab === 'recipes'
      ? this.posts.filter((post) => post.post_type === 'recipe')
      : this.posts.filter((post) => post.post_type !== 'recipe');
  }

  get shareUrl(): string {
    return this.profile ? `${window.location.origin}/community/profile/${this.profile.user_id}` : '';
  }

  get reportingPost(): Post | null {
    return this.reportingPostId
      ? this.posts.find((p) => p.post_id === this.reportingPostId) || null
      : null;
  }

  get canSaveProfile(): boolean {
    return (
      !this.editSaving &&
      !this.avatarUploading &&
      !!this.edit.profile_name.trim() &&
      !!this.edit.community_name.trim()
    );
  }

  // Close the "•••" menu on outside click / Escape
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen) return;
    const menuWrap = this.host.nativeElement.querySelector('.menu-wrap');
    if (menuWrap && !menuWrap.contains(event.target as Node)) this.menuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen) this.menuOpen = false;
    else if (this.editOpen && !this.editSaving) this.editOpen = false;
  }

  initials(name: string): string {
    return (name || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase();
  }

  setTab(tab: ProfileTab): void {
    this.activeTab = tab;
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  openShareAccount(): void {
    this.menuOpen = false;
    this.shareOpen = true;
  }

  openReportAccount(): void {
    this.menuOpen = false;
    if (!this.auth.isAuthenticated()) {
      this.authModal.open('login');
      return;
    }
    this.reportOpen = true;
  }

  private load(userId: string): void {
    this.loading = true;
    this.notFound = false;
    this.posts = [];
    this.menuOpen = false;
    this.community.getPublicProfile(userId).subscribe({
      next: (profile) => {
        this.profile = profile;
        this.loading = false;
        this.community.getFeed(1, 100, 'MY_POST', 'created_at', userId).subscribe({
          next: (result) => {
            this.posts = result.data;
            this.cdr.markForCheck();
          },
        });
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.notFound = true;
        this.cdr.markForCheck();
      },
    });
  }

  // ── Follow ──

  toggleFollow(): void {
    if (!this.profile || this.followBusy) return;
    if (!this.auth.isAuthenticated()) {
      this.authModal.open('login');
      return;
    }
    this.followBusy = true;
    this.community.toggleFollow(this.profile.user_id).subscribe({
      next: (result) => {
        if (!this.profile) return;
        this.profile.is_following = result.following;
        this.profile.follower_count = Math.max(
          0,
          this.profile.follower_count + (result.following ? 1 : -1),
        );
        this.followBusy = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.followBusy = false;
        this.toast.error('Could not update follow status.');
        this.cdr.markForCheck();
      },
    });
  }

  // ── Post card actions ──

  likePost(postId: string): void {
    if (!this.auth.isAuthenticated()) {
      this.authModal.open('login');
      return;
    }
    this.community.likePost(postId).subscribe((res) => {
      const p = this.posts.find((x) => x.post_id === postId);
      if (p) {
        p.like_count = res.like_count;
        p.liked = res.liked;
        this.cdr.markForCheck();
      }
    });
  }

  savePost(postId: string): void {
    if (!this.auth.isAuthenticated()) {
      this.authModal.open('login');
      return;
    }
    this.community.savePost(postId).subscribe((res) => {
      const p = this.posts.find((x) => x.post_id === postId);
      if (p) {
        p.save_count = res.save_count;
        p.saved = res.saved;
        this.cdr.markForCheck();
      }
    });
  }

  sharePost(postId: string): void {
    this.postShareUrl = `${window.location.origin}/community/post/${postId}`;
    this.postShareOpen = true;
    this.cdr.markForCheck();
    this.community.sharePost(postId).subscribe((res) => {
      const p = this.posts.find((x) => x.post_id === postId);
      if (p) {
        p.share_count = res.share_count;
        this.cdr.markForCheck();
      }
    });
  }

  goToDetail(postId: string): void {
    void this.router.navigate(['/community/post', postId]);
  }

  openReport(postId: string): void {
    if (!this.auth.isAuthenticated()) {
      this.authModal.open('login');
      return;
    }
    this.reportingPostId = postId;
  }

  submitPostReport(payload: ReportPayload): void {
    const postId = this.reportingPostId;
    if (!postId || this.postReportSubmitting) return;
    this.postReportSubmitting = true;
    this.community.reportPost(postId, payload.reason, payload.note).subscribe({
      next: () => {
        this.postReportSubmitting = false;
        this.reportingPostId = null;
        this.toast.success('Thanks for letting us know. We will review this post.');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.postReportSubmitting = false;
        this.reportingPostId = null;
        this.toast.error(error?.error?.error || 'Failed to submit report. Please try again.');
        this.cdr.markForCheck();
      },
    });
  }

  promptDeletePost(postId: string): void {
    this.pendingDeletePost = this.posts.find((p) => p.post_id === postId) || null;
  }

  confirmDeletePost(): void {
    const post = this.pendingDeletePost;
    if (!post) return;
    this.pendingDeletePost = null;
    this.community.deletePost(post.post_id).subscribe({
      next: () => {
        this.posts = this.posts.filter((p) => p.post_id !== post.post_id);
        if (this.profile) {
          if (post.post_type === 'recipe') {
            this.profile.recipe_count = Math.max(0, this.profile.recipe_count - 1);
          } else {
            this.profile.post_count = Math.max(0, this.profile.post_count - 1);
          }
        }
        this.cdr.markForCheck();
      },
      error: () => this.toast.error('Failed to delete this post. Please try again.'),
    });
  }

  openEdit(post: Post): void {
    this.editingPost = post;
    this.editPostOpen = true;
  }

  closeEdit(): void {
    this.editPostOpen = false;
    this.editingPost = null;
  }

  onPostEdited(postId: string): void {
    this.community.getPostById(postId).subscribe((updated) => {
      this.posts = this.posts.map((p) => (p.post_id === postId ? updated : p));
      this.cdr.markForCheck();
    });
  }

  openCreatePost(): void {
    void this.router.navigate(['/community'], { queryParams: { create: 'post' } });
  }

  // ── Edit profile ──

  async editProfile(): Promise<void> {
    try {
      const response = await this.auth.getMe();
      const user = response?.user;
      if (!user) throw new Error('No user');
      this.edit = {
        profile_name: user.profile_name || '',
        community_name: user.community_name || '',
        email: user.email || '',
        phone: user.phone || '',
        avatar_url: user.avatar_url || '',
      };
      this.editError = '';
      this.editOpen = true;
      this.cdr.markForCheck();
    } catch {
      this.toast.error('Could not load your profile.');
    }
  }

  closeEditProfile(): void {
    if (this.editSaving) return;
    this.editOpen = false;
  }

  // Email / phone changes need OTP verification, which lives in the Account page
  goToAccountSettings(): void {
    this.editOpen = false;
    void this.router.navigate(['/account']);
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    this.avatarUploading = true;
    this.cloudinary.uploadFile(file).subscribe({
      next: (result) => {
        this.edit.avatar_url = result.url;
        this.avatarUploading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.avatarUploading = false;
        this.toast.error('Photo upload failed.');
        this.cdr.markForCheck();
      },
    });
  }

  removeAvatar(): void {
    this.edit.avatar_url = '';
  }

  saveProfile(): void {
    if (!this.canSaveProfile) return;
    this.editSaving = true;
    this.editError = '';
    this.community
      .updateMyProfile({
        ...this.edit,
        profile_name: this.edit.profile_name.trim(),
        community_name: this.edit.community_name.trim(),
      })
      .subscribe({
        next: (response) => {
          this.auth.setUser(response.user);
          this.editSaving = false;
          this.editOpen = false;
          if (this.profile) {
            this.profile.username = response.user.community_name || response.user.profile_name;
            this.profile.avatar_url = response.user.avatar_url || null;
          }
          this.toast.success('Profile updated.');
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.editSaving = false;
          this.editError = error?.error?.error || 'Could not save changes.';
          this.cdr.markForCheck();
        },
      });
  }

  // ── Report account ──

  submitAccountReport(payload: ReportPayload): void {
    if (!this.profile || this.reportSubmitting) return;
    this.reportSubmitting = true;
    this.community.reportAccount(this.profile.user_id, payload.reason, payload.note).subscribe({
      next: () => {
        this.reportSubmitting = false;
        this.reportOpen = false;
        this.toast.success('Thanks for letting us know. We will review this account.');
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.reportSubmitting = false;
        this.toast.error(error?.error?.error || 'Failed to submit report.');
        this.cdr.markForCheck();
      },
    });
  }
}
