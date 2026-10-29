import { ChangeDetectorRef, Component, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideCheck,
  LucideChevronRight,
  LucideCopy,
  LucideTriangleAlert,
  LucideUserPlus,
  LucideX
} from '@lucide/angular';
import { AdminRole } from '../../../../shared/models/admin-role.model';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminStaffService, StaffMember, StaffOpenWork } from '../../services/admin-staff.service';

interface RoleOption {
  value: AdminRole;
  label: string;
  description: string;
}

// Chip labels and scope follow the role table (Staff 2.1 in Figma).
export const STAFF_ROLE_OPTIONS: readonly RoleOption[] = [
  { value: 'admin_cc', label: 'Admin CC', description: 'Staff, revenue, logs, everything' },
  { value: 'qlsp', label: 'QLSP', description: 'Orders, products, customers, vouchers' },
  { value: 'cskh', label: 'CSKH', description: 'Recipes, reports, chat, reviews' }
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ConfirmKind = 'disable' | 'enable' | 'reset';

@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ConfirmationModalComponent,
    LucideCheck,
    LucideChevronRight,
    LucideCopy,
    LucideTriangleAlert,
    LucideUserPlus,
    LucideX
  ],
  templateUrl: './staff.component.html',
  styleUrl: './staff.component.scss'
})
export class AdminStaffComponent implements OnInit {
  private staffService = inject(AdminStaffService);
  private adminAuth = inject(AdminAuthService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  readonly roleOptions = STAFF_ROLE_OPTIONS;

  staff: StaffMember[] = [];
  loading = true;
  error = '';
  busyUserId: string | null = null;
  /** Avatars whose URL failed to load fall back to initials */
  brokenAvatars = new Set<string>();

  // ── Add staff ──
  addOpen = false;
  addSaving = false;
  addError = '';
  newStaff = { profile_name: '', email: '', role: 'cskh' as AdminRole };

  // ── Temporary password, shown once after create / reset ──
  credentials: { name: string; email: string; password: string; created: boolean } | null = null;
  copied = false;

  // ── Change role ──
  roleTarget: StaffMember | null = null;
  roleChoice: AdminRole | null = null;
  roleSaving = false;
  roleError = '';
  openWork: StaffOpenWork | null = null;

  // ── Disable / enable / reset password (shared confirmation modal) ──
  confirmTarget: StaffMember | null = null;
  confirmKind: ConfirmKind | null = null;
  disableReason = '';
  confirmError = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = this.staff.length === 0;
    this.error = '';
    this.staffService.list().subscribe({
      next: (res) => {
        this.staff = res.data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Staff could not be loaded.';
        this.cdr.markForCheck();
      }
    });
  }

  // ── Row helpers ──

  get activeCount(): number {
    return this.staff.filter((s) => s.status === 'active').length;
  }

  isSelf(member: StaffMember): boolean {
    return member.user_id === this.adminAuth.getUser()?.user_id;
  }

  // The last active Admin CC can be neither demoted nor disabled.
  isLastAdminCc(member: StaffMember): boolean {
    return member.role === 'admin_cc' && member.status === 'active'
      && this.staff.filter((s) => s.role === 'admin_cc' && s.status === 'active').length <= 1;
  }

  roleLabel(role: AdminRole): string {
    return this.roleOptions.find((o) => o.value === role)?.label || role;
  }

  initials(name: string): string {
    return avatarInitials(name);
  }

  firstName(member: StaffMember): string {
    return (member.profile_name || '').trim().split(/\s+/)[0] || member.profile_name;
  }

  lastSignIn(member: StaffMember): string {
    if (!member.last_login_at) {
      return member.created_at ? `Never · invited ${this.shortDate(member.created_at)}` : 'Never';
    }
    const date = new Date(member.last_login_at);
    if (date.toDateString() === new Date().toDateString()) {
      return `Today ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return this.shortDate(member.last_login_at);
  }

  private shortDate(value: string): string {
    const date = new Date(value);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private replaceRow(updated: StaffMember): void {
    this.staff = this.staff.map((s) => (s.user_id === updated.user_id ? updated : s));
  }

  private returnedChatsNote(count: number): string {
    return count ? ` ${count} open chat${count > 1 ? 's' : ''} returned to the queue.` : '';
  }

  // ── Add staff ──

  openAdd(): void {
    this.newStaff = { profile_name: '', email: '', role: 'cskh' };
    this.addError = '';
    this.addOpen = true;
  }

  closeAdd(): void {
    if (!this.addSaving) this.addOpen = false;
  }

  get canCreate(): boolean {
    return !this.addSaving && !!this.newStaff.profile_name.trim() && EMAIL_REGEX.test(this.newStaff.email.trim());
  }

  createStaff(): void {
    if (!this.canCreate) return;
    this.addSaving = true;
    this.addError = '';
    this.staffService.create({
      profile_name: this.newStaff.profile_name.trim(),
      email: this.newStaff.email.trim(),
      role: this.newStaff.role
    }).subscribe({
      next: (res) => {
        this.addSaving = false;
        this.addOpen = false;
        this.staff = [...this.staff, res.data];
        this.showCredentials(res.data, res.temp_password, true);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.addSaving = false;
        this.addError = err?.error?.error || 'Could not create the account.';
        this.cdr.markForCheck();
      }
    });
  }

  private showCredentials(member: StaffMember, password: string, created: boolean): void {
    this.copied = false;
    this.credentials = { name: member.profile_name, email: member.email, password, created };
  }

  copyPassword(): void {
    if (!this.credentials) return;
    void navigator.clipboard?.writeText(this.credentials.password).then(() => {
      this.copied = true;
      this.cdr.markForCheck();
    });
  }

  // ── Change role ──

  openChangeRole(member: StaffMember): void {
    if (this.isSelf(member) || this.isLastAdminCc(member)) return;
    this.roleTarget = member;
    this.roleChoice = null;
    this.roleError = '';
    this.openWork = null;
    this.staffService.getOpenWork(member.user_id).subscribe({
      next: (res) => {
        if (this.roleTarget?.user_id === member.user_id) this.openWork = res.data;
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  closeChangeRole(): void {
    if (!this.roleSaving) this.roleTarget = null;
  }

  saveRole(): void {
    const target = this.roleTarget;
    const role = this.roleChoice;
    if (!target || !role || role === target.role || this.roleSaving) return;
    this.roleSaving = true;
    this.roleError = '';
    this.staffService.changeRole(target.user_id, role).subscribe({
      next: (res) => {
        this.roleSaving = false;
        this.roleTarget = null;
        this.replaceRow(res.data);
        this.toast.success(`${res.data.profile_name} is now ${this.roleLabel(role)}.${this.returnedChatsNote(res.returned_chats)}`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.roleSaving = false;
        this.roleError = err?.error?.error || 'Could not change the role.';
        this.cdr.markForCheck();
      }
    });
  }

  // ── Disable / enable / reset password ──

  openConfirm(member: StaffMember, kind: ConfirmKind): void {
    if (this.isSelf(member)) return;
    if (kind === 'disable' && this.isLastAdminCc(member)) return;
    this.confirmTarget = member;
    this.confirmKind = kind;
    this.disableReason = '';
    this.confirmError = '';
    this.openWork = null;
    if (kind === 'disable') {
      this.staffService.getOpenWork(member.user_id).subscribe({
        next: (res) => {
          if (this.confirmTarget?.user_id === member.user_id) this.openWork = res.data;
          this.cdr.markForCheck();
        },
        error: () => {}
      });
    }
  }

  closeConfirm(): void {
    if (this.busyUserId) return;
    this.confirmTarget = null;
    this.confirmKind = null;
  }

  get confirmTitle(): string {
    const name = this.confirmTarget?.profile_name || '';
    if (this.confirmKind === 'disable') return `Disable ${name}?`;
    if (this.confirmKind === 'enable') return `Enable ${name}?`;
    return `Reset password for ${name}?`;
  }

  get confirmMessage(): string {
    if (this.confirmKind === 'disable') return 'They are signed out and cannot sign in to the admin portal until the account is enabled again.';
    if (this.confirmKind === 'enable') return 'They can sign in again with their current password and role.';
    return 'A new temporary password is created. They must change it at their next sign-in.';
  }

  get confirmWarning(): string {
    if (this.confirmKind !== 'disable' || !this.openWork?.open_chats) return '';
    const n = this.openWork.open_chats;
    return `${this.firstName(this.confirmTarget!)} has ${n} open chat${n > 1 ? 's' : ''}. They return to the queue.`;
  }

  get confirmText(): string {
    if (this.confirmKind === 'disable') return 'Disable';
    if (this.confirmKind === 'enable') return 'Enable';
    return 'Reset password';
  }

  get confirmType(): 'danger' | 'success' | 'info' {
    if (this.confirmKind === 'disable') return 'danger';
    if (this.confirmKind === 'enable') return 'success';
    return 'info';
  }

  runConfirm(): void {
    const target = this.confirmTarget;
    const kind = this.confirmKind;
    if (!target || !kind || this.busyUserId) return;
    if (kind === 'disable' && !this.disableReason.trim()) {
      this.confirmError = 'Please enter a reason.';
      return;
    }
    this.busyUserId = target.user_id;
    this.confirmError = '';

    const done = () => {
      this.busyUserId = null;
      this.confirmTarget = null;
      this.confirmKind = null;
      this.cdr.markForCheck();
    };
    const fail = (err: any) => {
      this.busyUserId = null;
      this.confirmError = err?.error?.error || 'Something went wrong. Please try again.';
      this.cdr.markForCheck();
    };

    if (kind === 'reset') {
      this.staffService.resetPassword(target.user_id).subscribe({
        next: (res) => {
          this.replaceRow(res.data);
          done();
          this.showCredentials(res.data, res.temp_password, false);
        },
        error: fail
      });
      return;
    }

    const status = kind === 'disable' ? 'disabled' : 'active';
    this.staffService.setStatus(target.user_id, status, this.disableReason.trim()).subscribe({
      next: (res) => {
        this.replaceRow(res.data);
        done();
        this.toast.success(
          kind === 'disable'
            ? `${res.data.profile_name} has been disabled.${this.returnedChatsNote(res.returned_chats)}`
            : `${res.data.profile_name} can sign in again.`
        );
      },
      error: fail
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.credentials) this.credentials = null;
    else if (this.confirmTarget) this.closeConfirm();
    else if (this.roleTarget) this.closeChangeRole();
    else if (this.addOpen) this.closeAdd();
  }
}
