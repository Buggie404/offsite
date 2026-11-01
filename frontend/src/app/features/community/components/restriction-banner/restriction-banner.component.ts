import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideTriangleAlert } from '@lucide/angular';
import { AuthService } from '../../../../core/auth.service';
import { CommunityRestriction, CommunityService } from '../../services/community.service';

// Shown on Community during a suspension. It disappears by itself: an expired one no longer counts.
@Component({
  selector: 'app-restriction-banner',
  standalone: true,
  imports: [CommonModule, LucideTriangleAlert],
  template: `
    @if (message) {
      <div class="restriction-banner" role="status">
        <svg lucideTriangleAlert [size]="18"></svg>
        <p>{{ message }}</p>
      </div>
    }
  `,
  styles: `
    .restriction-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 1200px;
      margin: 16px auto;
      padding: 12px 16px;
      box-sizing: border-box;
      border: 1px solid rgba(198, 154, 0, 0.5);
      border-radius: 8px;
      background: #fbf3d5;
      color: #6b5200;
    }

    svg {
      flex: none;
    }

    p {
      margin: 0;
      font-size: 14px;
      line-height: 20px;
    }
  `
})
export class RestrictionBannerComponent implements OnInit {
  private community = inject(CommunityService);
  private auth = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  message = '';

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) return;
    this.community.getMyRestriction().subscribe({
      next: (restriction) => {
        this.message = this.describe(restriction);
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  private describe(restriction: CommunityRestriction | null): string {
    if (!restriction?.until || new Date(restriction.until) <= new Date()) return '';
    const date = new Date(restriction.until).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return restriction.level >= 3
      ? `Your Community access is limited until ${date}. You can view Community but cannot post, comment, like, save, share, report or follow.`
      : `Your Community access is limited until ${date}. You cannot post or comment during this time.`;
  }
}
