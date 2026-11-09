import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideArrowRight, LucideChevronLeft, LucideChevronRight, LucideEllipsis, LucideLock, LucideLockOpen } from '@lucide/angular';
import { ADMIN_ROLE_LABELS, AdminRole } from '../../../../shared/models/admin-role.model';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminCustomersService, CustomerDetail, CustomerOrder } from '../../services/admin-customers.service';
import { pageCount, pageList } from '../../pagination';
import { CustomerConversation } from '../../services/admin-customers.service';
import { ChatMessage, ChatService } from '../../../../core/services/chat.service';
import { VouchersComponent } from '../../../vouchers/pages/vouchers/vouchers.component';
import { AdminVoucher } from '../../../vouchers/services/admin-vouchers.service';
import { ReportPayload, ReportPostModalComponent } from '../../../../features/community/components/report-post-modal/report-post-modal.component';

type Tab = 'conversations' | 'orders' | 'notes' | 'vouchers' | 'violations';

const ORDERS_PAGE_SIZE = 20;

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', processing: 'Processing', shipping: 'Shipping', delivery_failed: 'Delivery failed',
  delivered: 'Delivered', canceled: 'Canceled', refund: 'Refunded', pending_refund: 'Refund requested', refund_rejected: 'Refund rejected'
};

@Component({
  selector: 'app-admin-customer-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ConfirmationModalComponent, LucideArrowLeft, LucideArrowRight, LucideChevronLeft, LucideChevronRight, LucideEllipsis, LucideLock, LucideLockOpen, VouchersComponent, ReportPostModalComponent],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss'
})
export class CustomerDetailComponent implements OnInit {
  private customersService = inject(AdminCustomersService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);
  private adminAuth = inject(AdminAuthService);
  get isSenior(): boolean { return this.adminAuth.getAdminRole() === 'admin_cc'; }
  private cdr = inject(ChangeDetectorRef);
  private chatService = inject(ChatService);
  conversations: CustomerConversation[] = [];
  selectedConversation: CustomerConversation | null = null;
  conversationMessages: ChatMessage[] = [];
  conversationsLoading = false;
  conversationsError = '';
  messagesLoading = false;
  messagesError = '';
  private messageVersion = 0;
  voucherCustomer: { user_id: string; profile_name: string; conversation_id: string } | null = null;
  reportOpen = false;
  reportPending = false;
  reportError = '';
  readonly levels = [{ value: 0, label: 'Clean' }, { value: 1, label: 'Warning' }, { value: 2, label: 'Restrict 3d' }, { value: 3, label: 'Restrict 7d' }];

  customer: CustomerDetail | null = null;
  loading = true;
  error = '';
  tab: Tab = 'orders';
  avatarBroken = false;

  // Purchase history: every order, 20 a page
  orders: CustomerOrder[] = [];
  ordersTotal = 0;
  ordersPage = 1;
  ordersLoading = false;
  ordersError = '';

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
    if (this.serviceCustomers) { this.tab = 'conversations'; this.loadConversations(); }
    this.load();
  }

  loadConversations(): void {
    this.conversationsLoading = true;
    this.conversationsError = '';
    this.customersService.conversations(this.userId).subscribe({
      next: res => {
        this.conversations = res.data;
        this.conversationsLoading = false;
        if (res.data.length) this.selectConversation(res.data[0]);
        this.cdr.markForCheck();
      },
      error: err => { this.conversationsLoading = false; this.conversationsError = err?.error?.error || 'Conversations could not be loaded.'; this.cdr.markForCheck(); }
    });
  }

  selectConversation(conversation: CustomerConversation): void {
    this.selectedConversation = conversation;
    this.conversationMessages = [];
    this.messagesLoading = true;
    this.messagesError = '';
    const version = ++this.messageVersion;
    this.customersService.conversationMessages(this.userId, conversation.conversation_id).subscribe({
      next: res => {
        if (version !== this.messageVersion) return;
        const seen = new Set<string>();
        this.conversationMessages = res.data.filter(message => {
          const id = message.source_message_id ? JSON.stringify([message.source_session_id, message.source_message_id]) : message._id;
          if (!id) return true;
          if (seen.has(id)) return false;
          seen.add(id); return true;
        });
        this.messagesLoading = false; this.cdr.markForCheck();
      },
      error: err => { if (version !== this.messageVersion) return; this.messagesLoading = false; this.messagesError = err?.error?.error || 'Messages could not be loaded.'; this.cdr.markForCheck(); }
    });
  }

  conversationLabel(conversation: CustomerConversation): string {
    if (conversation.close_outcome) return conversation.close_outcome.replaceAll('_', ' ');
    return conversation.status === 'bot' ? 'AI only' : conversation.status;
  }

  get violationLevel(): number {
    return Math.min(3, Math.max(this.customer?.violation_level || 0, ...(this.customer?.violations || []).map(row => row.level), 0));
  }

  voucherStatus(voucher: CustomerDetail['vouchers'][number]): string {
    if (voucher.used_count && voucher.usage_limit && voucher.used_count >= voucher.usage_limit) return 'Used';
    if (!voucher.is_active) return 'Stopped';
    if (voucher.valid_to.slice(0, 10) < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) return 'Expired';
    return voucher.used_count ? 'Used' : 'Unused';
  }

  openVoucher(): void {
    if (this.customer) this.voucherCustomer = { user_id: this.customer.user_id, profile_name: this.customer.profile_name, conversation_id: '' };
  }

  voucherCreated(event: { voucher: AdminVoucher }): void {
    if (this.customer) this.customer = { ...this.customer, vouchers: [{ ...event.voucher, title: null }, ...this.customer.vouchers] };
    this.voucherCustomer = null;
    this.toast.success('Personal voucher created.');
  }

  reportCustomer(payload: ReportPayload): void {
    if (!this.customer || this.reportPending) return;
    this.reportPending = true; this.reportError = '';
    this.chatService.reportCustomer(this.customer.user_id, payload.reason, payload.note).subscribe({
      next: () => { this.reportPending = false; this.reportOpen = false; this.toast.success('Account report submitted for review.'); this.cdr.markForCheck(); },
      error: err => { this.reportPending = false; this.reportError = err?.error?.error || 'The report could not be submitted.'; this.cdr.markForCheck(); }
    });
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
        this.loadOrders(1);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.status === 404 ? 'This customer does not exist.' : err?.error?.error || 'The customer could not be loaded.';
        this.cdr.markForCheck();
      }
    });
  }

  loadOrders(page: number): void {
    this.ordersLoading = true;
    this.ordersError = '';
    this.customersService.orders(this.userId, page).subscribe({
      next: (res) => {
        this.orders = res.data;
        this.ordersTotal = res.total;
        this.ordersPage = res.page;
        this.ordersLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.ordersLoading = false;
        this.ordersError = err?.error?.error || 'Orders could not be loaded.';
        this.cdr.markForCheck();
      }
    });
  }

  // ── Orders pagination ──

  get ordersPageCount(): number {
    return pageCount(this.ordersTotal, ORDERS_PAGE_SIZE);
  }

  get ordersPages(): (number | null)[] {
    return pageList(this.ordersPage, this.ordersPageCount);
  }

  get ordersRangeText(): string {
    const start = (this.ordersPage - 1) * ORDERS_PAGE_SIZE + 1;
    return `Showing ${start}-${Math.min(this.ordersPage * ORDERS_PAGE_SIZE, this.ordersTotal)} of ${this.ordersTotal.toLocaleString('en-US')}`;
  }

  goToOrdersPage(page: number): void {
    if (page < 1 || page > this.ordersPageCount || page === this.ordersPage || this.ordersLoading) return;
    this.loadOrders(page);
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

  // ── Notes ──

  addNote(): void {
    const content = this.noteDraft.trim();
    if (!content || this.noteSaving || !this.customer || this.customer.can_add_note === false) return;
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
