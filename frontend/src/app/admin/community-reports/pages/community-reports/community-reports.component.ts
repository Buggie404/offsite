import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleCheck,
  LucideEye,
  LucideEyeOff,
  LucideInbox,
  LucideLock,
  LucideLockOpen,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';
import { AdminRole } from '../../../../shared/models/admin-role.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import {
  AdminModerationService,
  HandledItem,
  ModerationActionType,
  QueueItem,
  ReportTargetType
} from '../../services/admin-moderation.service';

type Tab = 'waiting' | 'handled';

/** What the confirmation modal is about to do */
interface PendingAction {
  action: ModerationActionType;
  type: ReportTargetType;
  targetId: string;
  ownerName: string;
  excerpt: string;
  reporterCount: number;
  hidden: boolean;
}

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam', inappropriate: 'Inappropriate', off_topic: 'Off topic', misleading: 'Misleading', other: 'Other'
};
const TYPE_LABELS: Record<ReportTargetType, string> = { post: 'post', comment: 'comment', account: 'account' };
const ROLE_LABELS: Record<AdminRole, string> = { admin_cc: 'Admin CC', cskh: 'CSKH', qlsp: 'QLSP' };
const HANDLED_PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-community-reports',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideChevronLeft, LucideChevronRight, LucideCircleCheck, LucideEye, LucideEyeOff, LucideInbox,
    LucideLock, LucideLockOpen, LucideTriangleAlert, LucideX
  ],
  templateUrl: './community-reports.component.html',
  styleUrl: './community-reports.component.scss'
})
export class AdminCommunityReportsComponent implements OnInit {
  private moderation = inject(AdminModerationService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  tab: Tab = 'waiting';
  type: ReportTargetType | '' = '';
  readonly typeOptions: { value: ReportTargetType | ''; label: string }[] = [
    { value: '', label: 'Posts, comments & accounts' },
    { value: 'post', label: 'Posts' },
    { value: 'comment', label: 'Comments' },
    { value: 'account', label: 'Accounts' }
  ];

  queue: QueueItem[] = [];
  handled: HandledItem[] = [];
  handledTotal = 0;
  handledPage = 1;
  loading = true;
  error = '';
  brokenImages = new Set<string>();

  // Confirmation modal
  pending: PendingAction | null = null;
  message = '';
  alsoHide = false;
  notifyReporters = true;
  saving = false;
  modalError = '';

  ngOnInit(): void {
    this.load();
  }

  // ── Loading ──

  load(): void {
    this.loading = true;
    this.error = '';
    if (this.tab === 'waiting') {
      this.moderation.queue(this.type).subscribe({
        next: (res) => this.done(() => (this.queue = res.data)),
        error: (err) => this.fail(err)
      });
    } else {
      this.moderation.handled(this.type, this.handledPage).subscribe({
        next: (res) => this.done(() => {
          this.handled = res.data;
          this.handledTotal = res.total;
        }),
        error: (err) => this.fail(err)
      });
    }
  }

  private done(apply: () => void): void {
    apply();
    this.loading = false;
    this.cdr.markForCheck();
  }

  private fail(err: any): void {
    this.loading = false;
    this.error = err?.error?.error || 'Reports could not be loaded.';
    this.cdr.markForCheck();
  }

  setTab(tab: Tab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.handledPage = 1;
    this.load();
  }

  setType(type: ReportTargetType | ''): void {
    this.type = type;
    this.handledPage = 1;
    this.load();
  }

  // ── Display helpers ──

  initials(name: string | null): string {
    return avatarInitials(name || '');
  }

  typeLabel(type: ReportTargetType): string {
    return TYPE_LABELS[type];
  }

  roleLabel(role: AdminRole): string {
    return ROLE_LABELS[role] || role;
  }

  reasonSummary(item: QueueItem): string {
    return Object.entries(item.reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => (count > 1 ? `${REASON_LABELS[reason] || reason} x${count}` : REASON_LABELS[reason] || reason))
      .join(' · ');
  }

  topReason(item: QueueItem): string {
    return Object.entries(item.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
  }

  dateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${day} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }

  shortName(name: string | null): string {
    if (!name) return 'Staff';
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : name;
  }

  handledSummary(row: HandledItem): string {
    const verb: Record<HandledItem['action'], string> = {
      hide: 'Hidden', restore: 'Restored', warn: row.also_hidden ? 'Warned + hidden' : 'Warned',
      lock: row.also_hidden ? 'Account locked + hidden' : 'Account locked', unlock: 'Account unlocked', dismiss: 'Dismissed'
    };
    return `${verb[row.action]} by ${this.shortName(row.admin_name)} (${this.roleLabel(row.admin_role)}) · ${this.dateTime(row.created_at)}`;
  }

  get waitingCount(): number {
    return this.queue.length;
  }

  // ── Confirmation modal ──

  open(item: QueueItem, action: ModerationActionType): void {
    this.openFor({
      action,
      type: item.target_type,
      targetId: item.target_id,
      ownerName: item.owner_name,
      excerpt: item.content,
      reporterCount: item.reporter_count,
      hidden: item.content_status === 'hidden' || (item.target_type === 'account' && item.owner_status === 'locked')
    }, this.topReason(item));
  }

  /** Undo from the Handled tab: restore hidden content or unlock the account */
  undo(row: HandledItem): void {
    this.openFor({
      action: 'restore',
      type: row.content_hidden ? row.target_type : 'account',
      targetId: row.content_hidden ? row.target_id : row.owner_id || row.target_id,
      ownerName: row.owner_name || '',
      excerpt: '',
      reporterCount: 0,
      hidden: true
    }, 'other');
  }

  private openFor(pending: PendingAction, reason: string): void {
    this.pending = pending;
    this.message = this.template(pending, reason);
    this.alsoHide = pending.action === 'lock' && pending.type !== 'account' && !pending.hidden;
    this.notifyReporters = pending.reporterCount > 0;
    this.modalError = '';
  }

  private template(p: PendingAction, reason: string): string {
    const what = p.type === 'comment' ? 'comment' : 'post';
    const why: Record<string, string> = {
      spam: 'it looks like spam or advertising',
      inappropriate: 'it breaks our community guidelines',
      off_topic: 'it is off topic for the community',
      misleading: 'it contains misleading claims',
      other: 'it breaks our community guidelines'
    };
    switch (p.action) {
      case 'hide': return `Your ${what} was hidden because ${why[reason] || why['other']}.`;
      case 'warn': return `This is a warning: your ${p.type === 'account' ? 'profile' : what} was reported because ${why[reason] || why['other']}. Repeated violations can lead to your account being locked.`;
      case 'lock': return `Your account has been locked because ${why[reason] || why['other']}. Contact us if you think this is a mistake.`;
      case 'restore': return p.type === 'account'
        ? 'Your account has been unlocked after review. Welcome back.'
        : `Your ${what} is visible again after review.`;
      default: return '';
    }
  }

  get modalTitle(): string {
    const p = this.pending;
    if (!p) return '';
    const handle = `@${p.ownerName}`;
    const what = TYPE_LABELS[p.type];
    switch (p.action) {
      case 'hide': return `Hide ${what} by ${handle}`;
      case 'restore': return p.type === 'account' ? `Unlock ${handle}` : `Restore ${what} by ${handle}`;
      case 'warn': return `Warn ${handle}`;
      case 'lock': return `Lock ${handle}`;
      default: return `Dismiss reports on ${handle}`;
    }
  }

  get modalEffect(): string {
    const p = this.pending;
    if (!p) return '';
    const what = TYPE_LABELS[p.type];
    switch (p.action) {
      case 'hide': return `The ${what} is hidden from the community and its reports are closed.`;
      case 'restore': return p.type === 'account' ? 'The customer can sign in again.' : `The ${what} is visible again.`;
      case 'warn': return 'A warning is added to the account. They can still post.';
      case 'lock': return 'The customer is signed out and cannot sign in until unlocked.';
      default: return 'The reports are closed and nothing changes for the author.';
    }
  }

  get confirmLabel(): string {
    const labels: Record<ModerationActionType, string> = {
      hide: 'Hide', restore: this.pending?.type === 'account' ? 'Unlock' : 'Restore', warn: 'Send warning', lock: 'Lock account', dismiss: 'Dismiss'
    };
    return this.pending ? labels[this.pending.action] : '';
  }

  /** Hide / warn / lock must carry a message (it is also the logged reason) */
  get messageRequired(): boolean {
    return !!this.pending && ['hide', 'warn', 'lock'].includes(this.pending.action);
  }

  get canHideToo(): boolean {
    const p = this.pending;
    return !!p && ['warn', 'lock'].includes(p.action) && p.type !== 'account' && !p.hidden;
  }

  closeModal(): void {
    if (!this.saving) this.pending = null;
  }

  confirm(): void {
    const p = this.pending;
    if (!p || this.saving) return;
    if (this.messageRequired && !this.message.trim()) {
      this.modalError = 'Write the message the author will receive.';
      return;
    }
    this.saving = true;
    this.modalError = '';
    this.moderation.moderate({
      target_type: p.type,
      target_id: p.targetId,
      action: p.action,
      message: p.action === 'dismiss' ? '' : this.message.trim(),
      also_hide: this.canHideToo && this.alsoHide,
      notify_reporters: this.notifyReporters
    }).subscribe({
      next: () => {
        this.saving = false;
        this.pending = null;
        this.toast.success(this.successText(p));
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.modalError = err?.error?.error || 'The action could not be completed.';
        this.cdr.markForCheck();
      }
    });
  }

  private successText(p: PendingAction): string {
    switch (p.action) {
      case 'hide': return 'Content hidden and the author notified.';
      case 'restore': return p.type === 'account' ? 'Account unlocked.' : 'Content restored.';
      case 'warn': return 'Warning sent.';
      case 'lock': return 'Account locked.';
      default: return 'Reports dismissed.';
    }
  }

  // ── Handled pagination ──

  get handledPages(): number {
    return Math.max(1, Math.ceil(this.handledTotal / HANDLED_PAGE_SIZE));
  }

  goTo(page: number): void {
    if (page < 1 || page > this.handledPages || page === this.handledPage) return;
    this.handledPage = page;
    this.load();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeModal();
  }
}
