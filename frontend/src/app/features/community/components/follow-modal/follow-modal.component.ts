import { AfterViewInit, ChangeDetectorRef, Component, DestroyRef, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommunityService, FollowUser } from '../../services/community.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { ToastService } from '../../../../shared/services/toast.service';

@Component({
  selector: 'app-follow-modal', standalone: true, imports: [RouterLink, FormsModule],
  templateUrl: './follow-modal.component.html', styleUrl: './follow-modal.component.scss'
})
export class FollowModalComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) userId!: string;
  @Input() username = '';
  @Input() followersCount = 0;
  @Input() followingCount = 0;
  @Input() type: 'followers' | 'following' = 'followers';
  @Output() close = new EventEmitter<void>();
  @Output() followChanged = new EventEmitter<{ userId: string; following: boolean }>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  private community = inject(CommunityService);
  private auth = inject(AuthService);
  private authModal = inject(AuthModalService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  users: FollowUser[] = [];
  busy = new Set<string>();
  loading = false;
  error = false;
  hasMore = false;
  private page = 1;
  total = 0;
  search = '';
  initials = avatarInitials;
  private request?: Subscription;
  private searchTimer?: ReturnType<typeof setTimeout>;

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    this.request?.unsubscribe();
  }

  selectTab(type: 'followers' | 'following'): void {
    if (this.type === type) return;
    this.type = type;
    this.search = '';
    this.restart();
  }

  searchChanged(): void {
    clearTimeout(this.searchTimer);
    this.request?.unsubscribe();
    this.users = [];
    this.loading = true;
    this.searchTimer = setTimeout(() => this.restart(), 250);
  }

  private restart(): void {
    clearTimeout(this.searchTimer);
    this.request?.unsubscribe();
    this.page = 1;
    this.users = [];
    this.total = 0;
    this.hasMore = false;
    this.loading = false;
    this.load();
  }

  ngAfterViewInit(): void {
    this.dialog.nativeElement.showModal();
    this.load();
    this.cdr.detectChanges();
  }

  load(): void {
    if (this.loading) return;
    this.loading = true;
    this.error = false;
    this.request = this.community.getFollowList(this.userId, this.type, this.page, this.search).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.users = [...this.users, ...result.data];
        this.hasMore = result.has_more;
        this.total = result.total;
        this.page++;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.error = true; this.cdr.markForCheck(); }
    });
  }

  toggle(user: FollowUser): void {
    if (user.is_self || this.busy.has(user.user_id)) return;
    if (!this.auth.isAuthenticated()) { this.close.emit(); this.authModal.open('login'); return; }
    this.busy.add(user.user_id);
    this.community.toggleFollow(user.user_id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        user.is_following = result.following;
        this.busy.delete(user.user_id);
        this.followChanged.emit({ userId: user.user_id, following: result.following });
        this.cdr.markForCheck();
      },
      error: () => { this.busy.delete(user.user_id); this.toast.error('Could not update follow status.'); this.cdr.markForCheck(); }
    });
  }
}
