import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';

interface ReportedPost {
  post_id: string;
  user_id: string;
  author: { username: string; avatar_url: string | null };
  content: string;
  thumbnail: string | null;
  status: 'visible' | 'hidden';
  hidden_reason: 'manual' | 'auto_reports' | null;
  hidden_at: string | null;
  pending_reports: number;
  reasons: Record<string, number>;
  last_reported_at: string | null;
}

type Tab = 'pending' | 'hidden';

@Component({
  selector: 'app-admin-community-reports',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterModule],
  templateUrl: './community-reports.component.html',
  styleUrl: './community-reports.component.scss'
})
export class AdminCommunityReportsComponent implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  private readonly api = '/api/admin/community';

  rows: ReportedPost[] = [];
  threshold = 5;
  tab: Tab = 'pending';
  loading = true;
  busyId: string | null = null;
  error = '';

  readonly reasonLabels: Record<string, string> = {
    spam: 'Spam', inappropriate: 'Inappropriate', off_topic: 'Off topic', misleading: 'Misleading', other: 'Other'
  };

  get visibleRows(): ReportedPost[] {
    return this.tab === 'hidden'
      ? this.rows.filter(r => r.status === 'hidden')
      : this.rows.filter(r => r.status !== 'hidden' && r.pending_reports > 0);
  }

  get hiddenCount(): number { return this.rows.filter(r => r.status === 'hidden').length; }
  get pendingCount(): number { return this.rows.filter(r => r.status !== 'hidden' && r.pending_reports > 0).length; }

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.http.get<{ data: ReportedPost[]; auto_hide_threshold: number }>(`${this.api}/reports`).subscribe({
      next: res => {
        this.rows = res.data;
        this.threshold = res.auto_hide_threshold;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.error = err?.error?.error || 'Could not load reports';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  reasonList(r: ReportedPost): string {
    return Object.entries(r.reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${this.reasonLabels[k] || k} ×${n}`)
      .join(' · ');
  }

  hide(r: ReportedPost): void {
    if (!confirm(`Hide this post by @${r.author?.username}? It disappears from the community feed.`)) return;
    this.run(r, 'hide');
  }

  unhide(r: ReportedPost): void {
    if (!confirm('Make this post visible again? Its pending reports will be dismissed.')) return;
    this.run(r, 'unhide');
  }

  dismiss(r: ReportedPost): void {
    this.run(r, 'dismiss');
  }

  private run(r: ReportedPost, action: 'hide' | 'unhide' | 'dismiss'): void {
    this.busyId = r.post_id;
    this.http.post(`${this.api}/posts/${r.post_id}/${action}`, {}).subscribe({
      next: () => { this.busyId = null; this.load(); },
      error: err => {
        this.busyId = null;
        alert(err?.error?.error || 'Action failed');
        this.cdr.markForCheck();
      }
    });
  }
}
