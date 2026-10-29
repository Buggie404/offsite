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
  LucideArrowLeft,
  LucideCheck,
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
  ContactType,
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
import { FollowModalComponent } from '../../components/follow-modal/follow-modal.component';
import { avatarInitials } from '../../../../shared/utils/avatar';

type ProfileTab = 'posts' | 'recipes';

const EMPTY_EDIT: EditableProfile = {
  profile_name: '',
  community_name: '',
  email: '',
  phone: '',
  avatar_url: '',
  bio: '',
};

export const BIO_MAX_LENGTH = 160;
const OTP_RESEND_SECONDS = 2 * 60;

// Inline "Change email / phone" step inside the Edit profile modal
interface ContactChange {
  type: ContactType;
  step: 'input' | 'otp';
  value: string;
  otp: string;
  maskedContact: string;
  mockOtp: string;
  sending: boolean;
  verifying: boolean;
  error: string;
  countdown: number;
}

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
    FollowModalComponent,
    LucideArrowLeft,
    LucideCheck,
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
  followList: 'followers' | 'following' | null = null;

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
  readonly bioMaxLength = BIO_MAX_LENGTH;
  contactChange: ContactChange | null = null;
  verifiedContacts = new Set<ContactType>();
  private otpTimer: ReturnType<typeof setInterval> | null = null;

  // ── Post cards (same card + actions as the All Stories feed) ──
  currentUserId = computed<string | undefined>(() => this.auth.currentUser()?.user_id);
  postShareOpen = false;
  postShareUrl = '';
  reportingPostId: string | null = null;
  postReportSubmitting = false;
  pendingDeletePost: Post | null = null;
  editingPost: Post | null = null;
  editPostOpen = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopOtpTimer());
  }

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
      !this.contactChange &&
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
    else if (this.contactChange) this.cancelContactChange();
    else if (this.editOpen && !this.editSaving) this.editOpen = false;
  }

  initials(name: string): string {
    return avatarInitials(name);
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
    this.followList = null;
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

  // Keeps the header counters in sync when someone is (un)followed from the follow modal
  onFollowChanged(event: { userId: string; following: boolean }): void {
    if (!this.profile) return;
    if (this.profile.is_self) {
      this.profile.following_count = Math.max(
        0,
        this.profile.following_count + (event.following ? 1 : -1),
      );
    }
    if (this.profile.user_id === event.userId) {
      this.profile.is_following = event.following;
      this.profile.follower_count = Math.max(
        0,
        this.profile.follower_count + (event.following ? 1 : -1),
      );
    }
  }

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
        this.toast.error(
          error?.status === 409
            ? 'You have already reported this'
            : error?.error?.error || 'Failed to submit report. Please try again.',
        );
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
        bio: user.bio || '',
      };
      this.editError = '';
      this.cancelContactChange();
      this.verifiedContacts.clear();
      this.editOpen = true;
      this.cdr.markForCheck();
    } catch {
      this.toast.error('Could not load your profile.');
    }
  }

  closeEditProfile(): void {
    if (this.editSaving) return;
    this.cancelContactChange();
    this.editOpen = false;
  }

  // ── Change email / phone inline (OTP verified, saved with "Save changes") ──

  startContactChange(type: ContactType): void {
    this.stopOtpTimer();
    this.contactChange = {
      type,
      step: 'input',
      value: '',
      otp: '',
      maskedContact: '',
      mockOtp: '',
      sending: false,
      verifying: false,
      error: '',
      countdown: 0,
    };
  }

  cancelContactChange(): void {
    this.stopOtpTimer();
    this.contactChange = null;
  }

  private contactError(change: ContactChange): string {
    const value = change.value.trim();
    if (change.type === 'email') {
      if (!value) return 'Email is required.';
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) return 'Invalid email format.';
      if (value.toLowerCase() === this.edit.email.toLowerCase()) return 'This is already your email.';
    } else {
      if (!value) return 'Phone number is required.';
      if (!/^[0-9]{10,11}$/.test(value)) return 'Phone number must be 10-11 digits.';
      if (value === this.edit.phone) return 'This is already your phone number.';
    }
    return '';
  }

  sendContactOtp(): void {
    const change = this.contactChange;
    if (!change || change.sending || change.countdown > 0) return;
    change.error = this.contactError(change);
    if (change.error) return;
    change.sending = true;
    this.community.sendProfileOtp(change.type, change.value.trim()).subscribe({
      next: (res) => {
        change.sending = false;
        change.step = 'otp';
        change.otp = '';
        change.maskedContact = res.maskedContact || change.value.trim();
        change.mockOtp = res.__mock || '';
        this.startOtpTimer(change);
        this.cdr.markForCheck();
      },
      error: (error) => {
        change.sending = false;
        change.error = error?.error?.error || 'Failed to send the code.';
        this.cdr.markForCheck();
      },
    });
  }

  onOtpInput(value: string): void {
    if (!this.contactChange) return;
    this.contactChange.otp = value.replace(/\D/g, '').slice(0, 6);
    this.contactChange.error = '';
  }

  verifyContactOtp(): void {
    const change = this.contactChange;
    if (!change || change.verifying || change.otp.length !== 6) return;
    change.verifying = true;
    change.error = '';
    const value = change.value.trim();
    this.community.verifyProfileOtp(change.type, value, change.otp).subscribe({
      next: (res) => {
        if (change.type === 'email') this.edit.email = value.toLowerCase();
        else this.edit.phone = value;
        this.verifiedContacts.add(change.type);
        this.cancelContactChange();
        const linked = Array.isArray(res?.linked_guest_orders) ? res.linked_guest_orders.length : 0;
        if (linked) {
          this.toast.success(
            `We found ${linked} earlier order${linked > 1 ? 's' : ''} placed as a guest, now in your order history.`,
          );
        }
        this.cdr.markForCheck();
      },
      error: (error) => {
        change.verifying = false;
        change.otp = '';
        change.error = error?.error?.error || 'Verification failed.';
        this.cdr.markForCheck();
      },
    });
  }

  get otpCountdownLabel(): string {
    const seconds = this.contactChange?.countdown || 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private startOtpTimer(change: ContactChange): void {
    this.stopOtpTimer();
    change.countdown = OTP_RESEND_SECONDS;
    this.otpTimer = setInterval(() => {
      change.countdown = Math.max(0, change.countdown - 1);
      if (!change.countdown) this.stopOtpTimer();
      this.cdr.markForCheck();
    }, 1000);
  }

  private stopOtpTimer(): void {
    if (this.otpTimer) clearInterval(this.otpTimer);
    this.otpTimer = null;
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
        community_name: this.edit.community_name.trim(),
        bio: this.edit.bio.trim(),
      })
      .subscribe({
        next: (response) => {
          this.auth.setUser(response.user);
          this.editSaving = false;
          this.editOpen = false;
          if (this.profile) {
            this.profile.username = response.user.community_name || response.user.profile_name;
            this.profile.avatar_url = response.user.avatar_url || null;
            this.profile.bio = response.user.bio || '';
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
        this.toast.error(
          error?.status === 409
            ? 'You have already reported this'
            : error?.error?.error || 'Failed to submit report.',
        );
        this.cdr.markForCheck();
      },
    });
  }
}
