import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  LucideBan,
  LucideCheck,
  LucideChevronDown,
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
import { ADMIN_ROLE_LABELS, AdminRole } from '../../../../shared/models/admin-role.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import {
  AdminModerationService,
  HandledItem,
  ModerationActionType,
  PenaltyAction,
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
  /** Older full account lock, as opposed to a Community restriction */
  locked: boolean;
  reason: string;
  recommended?: PenaltyAction;
  restrictedUntil?: string | null;
  pointsForfeited?: boolean;
}

interface Penalty {
  action: PenaltyAction;
  level: number;
  label: string;
  days: number;
}

const PENALTIES: Penalty[] = [
  { action: 'warn', level: 1, label: 'Warn', days: 0 },
  { action: 'suspend_3d', level: 2, label: 'Restrict 3 days', days: 3 },
  { action: 'suspend_7d', level: 3, label: 'Restrict 7 days', days: 7 }
];

const LADDER = [{ level: 0, label: 'Clean' }, ...PENALTIES.map(({ level, label }) => ({ level, label }))];

const SEVERITY_BY_LEVEL: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };

const RESULT_LABELS: Record<HandledItem['action'], string> = {
  hide: 'Hidden', restore: 'Restored', warn: 'Warned', suspend_3d: 'Restricted 3 days', suspend_7d: 'Restricted 7 days',
  lift: 'Restriction lifted', lock: 'Account locked', unlock: 'Account unlocked', dismiss: 'Dismissed'
};

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam', inappropriate: 'Inappropriate', off_topic: 'Off topic', misleading: 'Misleading', other: 'Other'
};
const TYPE_LABELS: Record<ReportTargetType, string> = { post: 'post', comment: 'comment', account: 'account' };
const HANDLED_PAGE_SIZE = 20;

@Component({
  selector: 'app-admin-community-reports',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideBan, LucideCheck, LucideChevronDown, LucideChevronLeft, LucideChevronRight, LucideCircleCheck, LucideEye, LucideEyeOff, LucideInbox,
    LucideLock, LucideLockOpen, LucideTriangleAlert, LucideX
  ],
  templateUrl: './community-reports.component.html',
  styleUrl: './community-reports.component.scss'
})
export class AdminCommunityReportsComponent implements OnInit {
  private moderation = inject(AdminModerationService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  readonly penalties = PENALTIES;
  readonly ladder = LADDER;

  tab: Tab = 'waiting';
  type: ReportTargetType | '' = '';
  readonly typeOptions: { value: ReportTargetType | ''; label: string }[] = [
    { value: '', label: 'All' },
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
  sendToReporters = true;
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
    return ADMIN_ROLE_LABELS[role] || role;
  }

  reasonSummary(item: QueueItem): string {
    return Object.entries(item.reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => (count > 1 ? `${REASON_LABELS[reason] || reason} x${count}` : REASON_LABELS[reason] || reason))
      .join(' · ');
  }

  reasonLabel(reason: string): string {
    return REASON_LABELS[reason] || reason;
  }

  // ── Severity panel ──

  suggested(item: QueueItem): Penalty {
    return PENALTIES.find((penalty) => penalty.action === item.recommended_action) || PENALTIES[0];
  }

  severity(item: QueueItem): string {
    return SEVERITY_BY_LEVEL[this.suggested(item).level];
  }

  /** Where the author stands today: one step per earlier violation */
  currentLevel(item: QueueItem): number {
    return Math.min(item.owner_warnings, PENALTIES.length);
  }

  historyText(item: QueueItem): string {
    const last = item.last_violation;
    if (!last) return 'no prior violations.';
    const penalty = PENALTIES.find((p) => p.level === last.level);
    const date = new Date(last.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const total = item.owner_warnings > 1 ? ` (${item.owner_warnings} violations in total)` : '';
    return `L${last.level} ${penalty?.label || ''} on ${date}${total}.`;
  }

  suggestionWhy(item: QueueItem): string {
    const violation = item.owner_warnings + 1;
    const byHistory = Math.min(violation, PENALTIES.length);
    return `Violation no. ${violation} is L${byHistory}. ${this.reasonLabel(item.top_reason)} starts at L${item.reason_level}. The higher one applies.`;
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

  resultLabel(action: HandledItem['action']): string {
    return RESULT_LABELS[action];
  }

  handledSummary(row: HandledItem): string {
    const verb = `${RESULT_LABELS[row.action]}${row.also_hidden ? ' + hidden' : ''}`;
    const until = row.restricted_until ? ` until ${this.dateTime(row.restricted_until)}` : '';
    return `${verb}${until} by ${this.shortName(row.admin_name)} (${this.roleLabel(row.admin_role)}) · ${this.dateTime(row.created_at)}`;
  }

  /** Can this decision's Community restriction still be lifted? */
  canLift(row: HandledItem): boolean {
    return row.owner_restricted && (row.action === 'suspend_3d' || row.action === 'suspend_7d');
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
      hidden: item.content_status === 'hidden' || (item.target_type === 'account' && item.owner_status === 'locked'),
      locked: item.owner_status === 'locked',
      reason: item.top_reason,
      recommended: item.recommended_action,
      restrictedUntil: item.owner_restricted_until,
      pointsForfeited: item.points_forfeited
    });
  }

  /** Undo from the Handled tab: restore the hidden content */
  undo(row: HandledItem): void {
    this.openFor({
      action: 'restore', type: row.target_type, targetId: row.target_id, ownerName: row.owner_name || '',
      excerpt: '', reporterCount: 0, hidden: true, locked: false, reason: 'other', pointsForfeited: row.action !== 'dismiss'
    });
  }

  /** Undo from the Handled tab: lift the restriction, or unlock an account locked earlier */
  liftAccount(row: HandledItem): void {
    this.openFor({
      action: 'restore', type: 'account', targetId: row.owner_id || row.target_id, ownerName: row.owner_name || '',
      excerpt: '', reporterCount: 0, hidden: true, locked: row.owner_locked, reason: 'other'
    });
  }

  private openFor(pending: PendingAction): void {
    this.pending = pending;
    this.message = this.template(pending);
    this.sendToReporters = true;
    this.modalError = '';
  }

  private template(p: PendingAction): string {
    const reason = p.reason;
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
      case 'warn': return `This is a warning: your ${p.type === 'account' ? 'profile' : what} was reported because ${why[reason] || why['other']}. Please review our community guidelines.`;
      case 'suspend_3d': return `Your ${p.type === 'account' ? 'profile' : what} was reported because ${why[reason] || why['other']}. You cannot post or comment for 3 days.`;
      case 'suspend_7d': return `Your ${p.type === 'account' ? 'profile' : what} was reported because ${why[reason] || why['other']}. You can only view Community for 7 days.`;
      case 'restore': return p.type === 'account'
        ? (p.locked ? 'Your account has been unlocked after review. Welcome back.' : 'Your Community access is back to normal after review.')
        : `Your ${what} is visible again after review.`;
      default: return '';
    }
  }

  /** The penalty being applied, null for hide, restore and dismiss */
  get modalPenalty(): Penalty | null {
    return PENALTIES.find((penalty) => penalty.action === this.pending?.action) || null;
  }

  get modalTitle(): string {
    const p = this.pending;
    if (!p) return '';
    const handle = `@${p.ownerName}`;
    const what = TYPE_LABELS[p.type];
    const penalty = this.modalPenalty;
    if (penalty) return `Apply L${penalty.level} · ${penalty.days ? 'Restrict' : 'Warn'} ${handle}`;
    switch (p.action) {
      case 'hide': return `Hide ${what} by ${handle}`;
      case 'restore':
        if (p.type !== 'account') return `Restore ${what} by ${handle}`;
        return p.locked ? `Unlock ${handle}` : `Lift restriction for ${handle}`;
      default: return `Dismiss reports on ${handle}`;
    }
  }

  get modalSubtitle(): string {
    const p = this.pending;
    if (!this.modalPenalty || !p) return 'Please confirm before applying';
    if (p.recommended === p.action) return 'Suggested level · normal confirmation';
    const suggested = PENALTIES.find((penalty) => penalty.action === p.recommended);
    return `Not the suggested level (L${suggested?.level}) · check before applying`;
  }

  /** "Post "Matcha cures..." will be hidden" */
  get modalContent(): string {
    const p = this.pending;
    if (!p?.excerpt) return '';
    const name = p.type === 'account' ? 'Profile' : TYPE_LABELS[p.type].charAt(0).toUpperCase() + TYPE_LABELS[p.type].slice(1);
    const text = p.excerpt.length > 60 ? `${p.excerpt.slice(0, 60)}...` : p.excerpt;
    const hides = (p.action === 'hide' || !!this.modalPenalty) && p.type !== 'account' && !p.hidden;
    return `${name} "${text}"${hides ? ' will be hidden' : ''}`;
  }

  get modalEffect(): string {
    const p = this.pending;
    if (!p) return '';
    const what = TYPE_LABELS[p.type];
    switch (p.action) {
      case 'hide': return `The ${what} is hidden from the community and its reports are closed. ${this.pointsNote(p)}`;
      case 'restore':
        if (p.type === 'post') return `The post is visible again. ${p.pointsForfeited ? 'Its points stay taken back.' : 'Its points come back.'}`;
        if (p.type === 'comment') return 'The comment is visible again.';
        return p.locked ? 'The customer can sign in again.' : 'Their Community access is back to normal right away.';
      case 'warn': return `A warning is added to the account. They can still post, comment and shop normally. ${this.pointsNote(p)}`;
      case 'suspend_3d': return `Cannot post or comment until ${this.restrictedUntil(p, 3)}, and earns 50% fewer points until then. Can still read, and shop normally. ${this.pointsNote(p)}`;
      case 'suspend_7d': return `Can only view Community until ${this.restrictedUntil(p, 7)}, and earns 50% fewer points until then. Can still shop normally. ${this.pointsNote(p)}`;
      default: return 'The reports are closed and nothing changes for the author.';
    }
  }

  private pointsNote(p: PendingAction): string {
    return p.type === 'post' ? 'Its points are taken back for good, even if it is restored later.' : '';
  }

  /** A new penalty never shortens a running restriction */
  private restrictedUntil(p: PendingAction, days: number): string {
    const fromNow = Date.now() + days * 24 * 60 * 60 * 1000;
    const until = Math.max(fromNow, p.restrictedUntil ? new Date(p.restrictedUntil).getTime() : 0);
    return new Date(until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  get confirmLabel(): string {
    const p = this.pending;
    const penalty = this.modalPenalty;
    if (penalty) return `Apply L${penalty.level}`;
    const restoreLabel = p?.type !== 'account' ? 'Restore' : p.locked ? 'Unlock' : 'Lift restriction';
    const labels: Record<'hide' | 'restore' | 'dismiss', string> = { hide: 'Hide', restore: restoreLabel, dismiss: 'Dismiss' };
    return p ? labels[p.action as 'hide' | 'restore' | 'dismiss'] : '';
  }

  /** Hide and the penalties must carry a message (it is also the logged reason) */
  get messageRequired(): boolean {
    return !!this.pending && this.pending.action !== 'restore' && this.pending.action !== 'dismiss';
  }

  /** Dismissed reports stay quiet; other results can go to the reporters */
  get canNotifyReporters(): boolean {
    return !!this.pending?.reporterCount && this.messageRequired;
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
      notify_reporters: this.sendToReporters
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
      case 'restore':
        if (p.type !== 'account') return 'Content restored.';
        return p.locked ? 'Account unlocked.' : 'Restriction lifted.';
      case 'warn': return 'Warning sent.';
      case 'suspend_3d': return 'Restricted in Community for 3 days.';
      case 'suspend_7d': return 'Restricted in Community for 7 days.';
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
