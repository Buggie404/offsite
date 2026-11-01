import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription, debounceTime, merge } from 'rxjs';
import { LucideChefHat, LucideFlag, LucideSend } from '@lucide/angular';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { ChatService } from '../../../../core/services/chat.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { ChatQueueItem, DashboardTask, ServicesDashboardData, ServicesDashboardService, TaskType } from '../../services/services-dashboard.service';

type TaskFilter = TaskType | 'all';

const REASON_LABELS: Record<string, string> = {
  user_request: 'Asked for a person', refund: 'Refund', complaint: 'Complaint',
  order_change: 'Order change', no_answer: 'No answer found', llm_error: 'AI error'
};

@Component({
  selector: 'app-services-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, LucideChefHat, LucideFlag, LucideSend],
  templateUrl: './services-dashboard.component.html',
  styleUrl: './services-dashboard.component.scss'
})
export class ServicesDashboardComponent implements OnInit, OnDestroy {
  private readonly service = inject(ServicesDashboardService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly adminAuth = inject(AdminAuthService);
  private readonly toast = inject(ToastService);
  private readonly subs = new Subscription();

  data: ServicesDashboardData | null = null;
  loading = true;
  error = '';
  updatedAt: Date | null = null;
  filter: TaskFilter = 'all';
  claimingId = '';
  brokenAvatars = new Set<string>();

  get accountName(): string { return this.adminAuth.getDisplayName(); }
  get greeting(): string { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }

  get totalTasks(): number {
    const counts = this.data?.counts;
    return counts ? counts.reports + counts.recipes + counts.messages : 0;
  }

  get filters(): { value: TaskFilter; label: string; count: number }[] {
    const counts = this.data?.counts;
    if (!counts) return [];
    return [
      { value: 'all', label: 'All', count: this.totalTasks },
      { value: 'reports', label: 'Reports', count: counts.reports },
      { value: 'recipes', label: 'Recipes', count: counts.recipes },
      { value: 'messages', label: 'Messages', count: counts.messages }
    ];
  }

  get visibleTasks(): DashboardTask[] {
    const tasks = this.data?.tasks || [];
    return this.filter === 'all' ? tasks : tasks.filter((task) => task.type === this.filter);
  }

  ngOnInit(): void {
    this.load();
    // New handoffs, claims and messages arrive on the chat socket, so the queue stays live.
    this.chat.joinAgents();
    this.subs.add(merge(this.chat.conversation$, this.chat.listHint$).pipe(debounceTime(500)).subscribe(() => this.load()));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.chat.disconnect();
  }

  load(): void {
    this.loading = this.data === null;
    this.error = '';
    this.service.getDashboard().subscribe({
      next: (data) => {
        this.data = data;
        this.updatedAt = new Date();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Dashboard data could not be loaded.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  /** Takes the chat, then opens it in Support chat ready to reply */
  claim(item: ChatQueueItem): void {
    if (this.claimingId) return;
    this.claimingId = item.conversation_id;
    this.chat.claim(item.conversation_id).subscribe({
      next: () => {
        this.claimingId = '';
        void this.router.navigate(['/admin/chat'], { queryParams: { conversation: item.conversation_id } });
      },
      error: (err) => {
        this.claimingId = '';
        this.toast.error(err?.error?.error || 'This chat could not be claimed.');
        this.load();
      }
    });
  }

  initials(name: string): string { return avatarInitials(name); }
  reasonLabel(reason: string): string { return REASON_LABELS[reason] || reason; }
}
