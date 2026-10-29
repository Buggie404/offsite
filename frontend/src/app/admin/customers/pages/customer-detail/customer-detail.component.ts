import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideArrowLeft, LucideArrowRight, LucideLock, LucideLockOpen } from '@lucide/angular';
import { AdminRole } from '../../../../shared/models/admin-role.model';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { AdminCustomersService, CustomerDetail } from '../../services/admin-customers.service';

type Tab = 'orders' | 'notes';

const ROLE_LABELS: Record<AdminRole, string> = { admin_cc: 'Admin CC', qlsp: 'QLSP', cskh: 'CSKH' };
const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', processing: 'Processing', shipping: 'Shipping', delivery_failed: 'Delivery failed',
  delivered: 'Delivered', canceled: 'Canceled', refund: 'Refunded', pending_refund: 'Refund requested', refund_rejected: 'Refund rejected'
};

@Component({
  selector: 'app-admin-customer-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationModalComponent, LucideArrowLeft, LucideArrowRight, LucideLock, LucideLockOpen],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss'
})
export class CustomerDetailComponent implements OnInit {
  private customersService = inject(AdminCustomersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  customer: CustomerDetail | null = null;
  loading = true;
  error = '';
  tab: Tab = 'orders';
  avatarBroken = false;

  // Internal notes
  noteDraft = '';
  noteSaving = false;
  noteError = '';

  // Lock / unlock (shared confirmation modal)
  confirmOpen = false;
  lockReason = '';
  statusSaving = false;
  confirmError = '';

  ngOnInit(): void {
    this.load();
  }

  private get userId(): string {
    return this.route.snapshot.paramMap.get('userId') || '';
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.customersService.get(this.userId).subscribe({
      next: (res) => {
        this.customer = res.data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.status === 404 ? 'This customer does not exist.' : err?.error?.error || 'The customer could not be loaded.';
        this.cdr.markForCheck();
      }
    });
  }

  backToList(): void {
    void this.router.navigate(['/admin/customers'], { queryParamsHandling: 'preserve' });
  }

  // ── Display ──

  get initials(): string {
    return avatarInitials(this.customer?.profile_name || '');
  }

  get subtitle(): string {
    const c = this.customer;
    if (!c) return '';
    const since = c.created_at
      ? `customer since ${new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
      : 'customer';
    return [c.community_name ? `@${c.community_name}` : null, since].filter(Boolean).join(' · ');
  }

  roleLabel(role: AdminRole): string {
    return ROLE_LABELS[role] || role;
  }

  orderStatusLabel(status: string): string {
    return ORDER_STATUS_LABELS[status] || status;
  }

  shortDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  shortName(name: string | null): string {
    if (!name) return 'Staff';
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : name;
  }

  openOrder(orderId: string): void {
    void this.router.navigate(['/admin/orders', orderId]);
  }

  viewAllOrders(): void {
    const c = this.customer;
    if (!c) return;
    void this.router.navigate(['/admin/orders'], { queryParams: { search: c.email || c.user_id, date: '90' } });
  }

  // ── Notes ──

  addNote(): void {
    const content = this.noteDraft.trim();
    if (!content || this.noteSaving || !this.customer) return;
    this.noteSaving = true;
    this.noteError = '';
    this.customersService.addNote(this.customer.user_id, content).subscribe({
      next: (res) => {
        if (this.customer) this.customer = { ...this.customer, notes: [res.data, ...this.customer.notes] };
        this.noteDraft = '';
        this.noteSaving = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.noteSaving = false;
        this.noteError = err?.error?.error || 'The note could not be saved.';
        this.cdr.markForCheck();
      }
    });
  }

  // ── Lock / unlock ──

  get isLocked(): boolean {
    return this.customer?.status === 'suspended';
  }

  openStatusConfirm(): void {
    this.lockReason = '';
    this.confirmError = '';
    this.confirmOpen = true;
  }

  closeStatusConfirm(): void {
    if (!this.statusSaving) this.confirmOpen = false;
  }

  confirmStatus(): void {
    const c = this.customer;
    if (!c || this.statusSaving) return;
    const locking = !this.isLocked;
    if (locking && !this.lockReason.trim()) {
      this.confirmError = 'Please enter a reason.';
      return;
    }
    this.statusSaving = true;
    this.customersService.setStatus(c.user_id, locking ? 'suspended' : 'active', this.lockReason.trim()).subscribe({
      next: (res) => {
        if (this.customer) this.customer = { ...this.customer, ...res.data };
        this.statusSaving = false;
        this.confirmOpen = false;
        this.toast.success(locking ? `${c.profile_name}'s account is locked.` : `${c.profile_name}'s account is unlocked.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.statusSaving = false;
        this.confirmError = err?.error?.error || 'Something went wrong. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }
}
