import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommunityService, PublicProfile } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { Post } from '../../models/post.model';

@Component({
  selector: 'app-public-profile',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './public-profile.component.html',
  styleUrl: './public-profile.component.scss'
})
export class PublicProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private community = inject(CommunityService);
  private auth = inject(AuthService);
  private authModal = inject(AuthModalService);
  private cdr = inject(ChangeDetectorRef);

  profile: PublicProfile | null = null;
  posts: Post[] = [];
  loading = true;
  notFound = false;
  followBusy = false;

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('userId');
      if (id) this.load(id);
    });
  }

  private load(userId: string): void {
    this.loading = true;
    this.notFound = false;
    this.community.getPublicProfile(userId).subscribe({
      next: p => {
        this.profile = p;
        this.loading = false;
        this.cdr.markForCheck();
        this.community.getFeed(1, 30, 'MY_POST', 'created_at', userId).subscribe(res => {
          this.posts = res.data;
          this.cdr.markForCheck();
        });
      },
      error: () => { this.loading = false; this.notFound = true; this.cdr.markForCheck(); }
    });
  }

  toggleFollow(): void {
    if (!this.profile || this.followBusy) return;
    if (!this.auth.isAuthenticated()) { this.authModal.open('login'); return; }
    this.followBusy = true;
    this.community.toggleFollow(this.profile.user_id).subscribe({
      next: res => {
        this.profile!.is_following = res.following;
        this.profile!.follower_count += res.following ? 1 : -1;
        this.followBusy = false;
        this.cdr.markForCheck();
      },
      error: () => { this.followBusy = false; this.cdr.markForCheck(); }
    });
  }

  initials(name: string): string {
    return (name || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
  }
}
