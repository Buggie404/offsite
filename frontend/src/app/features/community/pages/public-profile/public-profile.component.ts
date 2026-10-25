import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommunityService, PublicProfile } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Post } from '../../models/post.model';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ReportPostModalComponent, ReportPayload } from '../../components/report-post-modal/report-post-modal.component';
import { CloudinaryService } from '../../services/cloudinary.service';

@Component({ selector: 'app-public-profile', standalone: true, imports: [CommonModule, FormsModule, RouterModule, ShareModalComponent, ReportPostModalComponent], templateUrl: './public-profile.component.html', styleUrl: './public-profile.component.scss' })
export class PublicProfileComponent implements OnInit {
  private route = inject(ActivatedRoute); private router = inject(Router); private community = inject(CommunityService);
  private auth = inject(AuthService); private authModal = inject(AuthModalService); private toast = inject(ToastService); private cdr = inject(ChangeDetectorRef);
  private http = inject(HttpClient); private cloudinary = inject(CloudinaryService);
  profile: PublicProfile | null = null; posts: Post[] = []; loading = true; notFound = false; followBusy = false;
  activeTab: 'posts' | 'recipes' = 'posts'; menuOpen = false; shareOpen = false; reportOpen = false; reportSubmitting = false;
  editOpen = false; editSaving = false; editError = '';
  edit = { profile_name: '', community_name: '', email: '', phone: '', avatar_url: '' };

  ngOnInit(): void { this.route.paramMap.subscribe(params => { const id = params.get('userId'); if (id) this.load(id); }); }
  get displayedPosts(): Post[] { return this.activeTab === 'recipes' ? this.posts.filter(post => post.post_type === 'recipe') : this.posts.filter(post => post.post_type !== 'recipe'); }
  get shareUrl(): string { return this.profile ? `${window.location.origin}/community/profile/${this.profile.user_id}` : ''; }
  private load(userId: string): void {
    this.loading = true; this.notFound = false; this.posts = [];
    this.community.getPublicProfile(userId).subscribe({ next: profile => {
      this.profile = profile; this.loading = false;
      this.community.getFeed(1, 100, 'MY_POST', 'created_at', userId).subscribe({ next: result => { this.posts = result.data; this.cdr.markForCheck(); } });
      this.cdr.markForCheck();
    }, error: () => { this.loading = false; this.notFound = true; this.cdr.markForCheck(); } });
  }
  toggleFollow(): void {
    if (!this.profile || this.followBusy) return;
    if (!this.auth.isAuthenticated()) { this.authModal.open('login'); return; }
    this.followBusy = true;
    this.community.toggleFollow(this.profile.user_id).subscribe({ next: result => { if (!this.profile) return; this.profile.is_following = result.following; this.profile.follower_count += result.following ? 1 : -1; this.followBusy = false; this.cdr.markForCheck(); }, error: () => { this.followBusy = false; this.toast.error('Could not update follow status.'); this.cdr.markForCheck(); } });
  }
  openCreatePost(): void { void this.router.navigate(['/community'], { queryParams: { create: 'post' } }); }
  async editProfile(): Promise<void> {
    try {
      const response = await this.auth.getMe(); const user = response?.user;
      if (!user) throw new Error();
      this.edit = { profile_name: user.profile_name || '', community_name: user.community_name || '', email: user.email || '', phone: user.phone || '', avatar_url: user.avatar_url || '' };
      this.editError = ''; this.editOpen = true; this.cdr.markForCheck();
    } catch { this.toast.error('Could not load your profile.'); }
  }
  onAvatarSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    this.cloudinary.uploadFile(file).subscribe({ next: result => { this.edit.avatar_url = result.url; this.cdr.markForCheck(); }, error: () => this.toast.error('Photo upload failed.') });
  }
  saveProfile(): void {
    if (!this.edit.profile_name.trim() || !this.edit.community_name.trim() || this.editSaving) return;
    this.editSaving = true; this.editError = '';
    this.http.put<{ user: any }>('/api/auth/profile', { ...this.edit, profile_name: this.edit.profile_name.trim(), community_name: this.edit.community_name.trim() }).subscribe({ next: response => {
      this.auth.setUser(response.user); this.editSaving = false; this.editOpen = false;
      if (this.profile) { this.profile.username = response.user.community_name || response.user.profile_name; this.profile.avatar_url = response.user.avatar_url || null; }
      this.toast.success('Profile updated.'); this.cdr.markForCheck();
    }, error: error => { this.editSaving = false; this.editError = error?.error?.error || 'Could not save changes.'; this.cdr.markForCheck(); } });
  }
  submitAccountReport(payload: ReportPayload): void {
    if (!this.profile || this.reportSubmitting) return; this.reportSubmitting = true;
    this.community.reportAccount(this.profile.user_id, payload.reason, payload.note).subscribe({ next: () => { this.reportSubmitting = false; this.reportOpen = false; this.toast.success('Thanks for letting us know. We will review this account.'); this.cdr.markForCheck(); }, error: error => { this.reportSubmitting = false; this.toast.error(error?.error?.error || 'Failed to submit report.'); this.cdr.markForCheck(); } });
  }
  initials(name: string): string { return (name || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase(); }
}
