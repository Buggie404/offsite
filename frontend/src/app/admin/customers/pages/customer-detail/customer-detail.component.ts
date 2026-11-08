import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowRight, LucideLock, LucideLockOpen, LucideArrowLeft } from '@lucide/angular';
import { ADMIN_ROLE_LABELS, AdminRole } from '../../../../shared/models/admin-role.model';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminCustomersService, CustomerDetail } from '../../services/admin-customers.service';

type Tab = 'orders' | 'notes' | 'vouchers' | 'violations';

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', processing: 'Processing', shipping: 'Shipping', delivery_failed: 'Delivery failed',
  delivered: 'Delivered', canceled: 'Canceled', refund: 'Refunded', pending_refund: 'Refund requested', refund_rejected: 'Refund rejected'
};

@Component({
  selector: 'app-admin-customer-detail',
  standalone: true,
  imports: [LucideArrowLeft,CommonModule, FormsModule, RouterLink, ConfirmationModalComponent, LucideArrowRight, LucideLock, LucideLockOpen],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss'
})
export class CustomerDetailComponent implements OnInit {
  private customersService = inject(AdminCustomersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  private adminAuth = inject(AdminAuthService);
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

  // Unlock (shared confirmation modal)
  confirmOpen = false;
  statusSaving = false;
  confirmError = '';
  get customersPath(): string { return this.route.snapshot.data['serviceCustomers'] ? '/admin/service-customers' : '/admin/customers'; }
  get serviceCustomers(): boolean { return !!this.route.snapshot.data['serviceCustomers']; }

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
    return ADMIN_ROLE_LABELS[role] || role;
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

  // ── Unlock (Senior Admin only): no admin can lock a customer, this is for accounts locked earlier ──

  get isLocked(): boolean {
    return this.customer?.status === 'suspended';
  }

  get canUnlock(): boolean {
    return this.isLocked && this.adminAuth.getAdminRole() === 'admin_cc';
  }

  openStatusConfirm(): void {
    this.confirmError = '';
    this.confirmOpen = true;
  }

  closeStatusConfirm(): void {
    if (!this.statusSaving) this.confirmOpen = false;
  }

  confirmStatus(): void {
    const c = this.customer;
    if (!c || this.statusSaving) return;
    this.statusSaving = true;
    this.customersService.setStatus(c.user_id, 'active').subscribe({
      next: (res) => {
        if (this.customer) this.customer = { ...this.customer, ...res.data };
        this.statusSaving = false;
        this.confirmOpen = false;
        this.toast.success(`${c.profile_name}'s account is unlocked.`);
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
