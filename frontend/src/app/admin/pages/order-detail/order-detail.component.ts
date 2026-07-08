import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import {
  LucideSave,
  LucideStickyNote,
  LucideXCircle,
  LucideAlertCircle,
  LucideEye,
  LucideCheck,
  LucideX,
  LucideUndo2
} from '@lucide/angular';
import { AdminOrderService } from '../../services/admin-order.service';
import { AdminRefreshService } from '../../services/admin-refresh.service';
import {
  AdminInternalNote,
  AdminOrderDetail,
  AdminOrderRefundRequest,
  AdminOrderStatus,
  AdminOrderStatusUpdate
} from '../../models/admin-order.model';

interface StatusOption {
  value: AdminOrderStatusUpdate;
  label: string;
}

interface TimelineStep {
  label: string;
  done: boolean;
  time: string;
}

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideSave,
    LucideStickyNote,
    LucideXCircle,
    LucideAlertCircle,
    LucideEye,
    LucideCheck,
    LucideX,
    LucideUndo2
  ],
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.scss'
})
export class OrderDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private adminOrderService = inject(AdminOrderService);
  private adminRefresh = inject(AdminRefreshService);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private readonly pollIntervalMs = 20_000;

  order: AdminOrderDetail | null = null;
  loading = true;
  error: string | null = null;

  selectedStatus: AdminOrderStatusUpdate = 'processing';
  noteText = '';

  statusSaving = false;
  refundSaving = false;
  noteSaving = false;

  statusMessage: string | null = null;
  refundMessage: string | null = null;
  noteMessage: string | null = null;
  actionError: string | null = null;

  showRefundModal = false;
  showRejectModal = false;
  rejectReason = '';
  rejectModalError: string | null = null;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const orderId = params.get('id');
      if (orderId) {
        this.loadOrder(orderId);
      }
    });

    this.adminRefresh.onOrderDetailRefresh$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const orderId = this.orderId;
        if (orderId) {
          this.loadOrder(orderId, true);
        }
      });

    interval(this.pollIntervalMs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (typeof document !== 'undefined' && !document.hidden && this.orderId) {
          this.loadOrder(this.orderId, true);
        }
      });
  }

  get orderId(): string {
    return this.order?.order_id || this.route.snapshot.paramMap.get('id') || '';
  }

  get itemCount(): number {
    return this.order?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;
  }

  get statusOptions(): StatusOption[] {
    if (!this.order) return [];

    if (this.order.order_status === 'processing' || this.order.order_status === 'pending') {
      return [{ value: 'shipping', label: 'Shipping' }];
    }

    return [];
  }

  get canUpdateStatus(): boolean {
    return this.statusOptions.length > 0;
  }

  get nextStatusOption(): StatusOption | null {
    return this.statusOptions[0] ?? null;
  }

  get hasPendingRefundRequest(): boolean {
    return (
      this.order?.refund_request?.status === 'pending' ||
      this.order?.order_status === 'pending_refund'
    );
  }

  get mainTimelineSteps(): TimelineStep[] {
    if (!this.order) return [];

    const status = this.order.order_status;
    const findHistoryTime = (target: string): string | null => {
      const entry = [...this.order!.status_history]
        .reverse()
        .find((item) => item.status === target);
      return entry ? this.formatDateTime(entry.changed_at) : null;
    };

    const reachedDelivered =
      status === 'delivered' ||
      status === 'refund' ||
      status === 'pending_refund' ||
      status === 'refund_rejected' ||
      !!this.order.delivered_at;

    const isShipping =
      status === 'shipping' || reachedDelivered;
    const isProcessed = ['processing', 'shipping', 'delivered', 'refund', 'canceled', 'pending_refund', 'refund_rejected'].includes(status);

    return [
      {
        label: 'Delivered',
        done: reachedDelivered,
        time: reachedDelivered
          ? this.formatDateTime(this.order.delivered_at) || findHistoryTime('delivered') || '—'
          : 'Pending'
      },
      {
        label: 'Shipping',
        done: isShipping,
        time: isShipping ? findHistoryTime('shipping') || '—' : 'Pending'
      },
      {
        label: 'Processing',
        done: isProcessed,
        time: isProcessed ? findHistoryTime('processing') || findHistoryTime('pending') || '—' : 'Pending'
      },
      {
        label: 'Order placed',
        done: true,
        time: this.formatDateTime(this.order.created_at)
      }
    ];
  }

  get showExceptionSection(): boolean {
    return (
      this.showRefundProcessing ||
      this.showRefunded ||
      this.showRefundRejected ||
      this.showCanceled
    );
  }

  get showRefundProcessing(): boolean {
    const refundStatus = this.order?.refund_request?.status;
    return refundStatus === 'pending' || refundStatus === 'approved' || refundStatus === 'rejected';
  }

  get showRefundProcessingActive(): boolean {
    return (
      this.order?.refund_request?.status === 'pending' ||
      this.order?.order_status === 'pending_refund'
    );
  }

  get showRefunded(): boolean {
    return (
      this.order?.refund_request?.status === 'approved' ||
      this.order?.order_status === 'refund'
    );
  }

  get showRefundRejected(): boolean {
    return (
      this.order?.refund_request?.status === 'rejected' ||
      this.order?.order_status === 'refund_rejected'
    );
  }

  get showCanceled(): boolean {
    return this.order?.order_status === 'canceled' || !!this.order?.canceled_at;
  }

  get activeRefundRequest(): AdminOrderRefundRequest | null {
    return this.order?.refund_request || null;
  }

  loadOrder(orderId: string, silent = false): void {
    if (!silent) {
      this.loading = true;
      this.error = null;
    }

    this.adminOrderService.getOrderById(orderId).subscribe({
      next: (response) => {
        this.order = response.data;
        this.selectedStatus = this.statusOptions[0]?.value || 'processing';
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (!silent) {
          this.error = 'Failed to load order details. Please try again.';
        }
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  saveStatus(): void {
    if (!this.order || this.statusSaving || !this.canUpdateStatus) return;

    this.statusSaving = true;
    this.actionError = null;
    this.statusMessage = null;

    this.adminOrderService
      .updateOrderStatus(this.order.order_id, this.selectedStatus, 'Status updated by admin')
      .subscribe({
        next: (response) => {
          this.order = response.data;
          this.selectedStatus = this.statusOptions[0]?.value || 'processing';
          this.statusMessage = 'Status saved. Customer notification queued.';
          this.statusSaving = false;
          this.adminRefresh.refreshNotifications();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.actionError = err.error?.error || 'Failed to update order status.';
          this.statusSaving = false;
          this.cdr.markForCheck();
        }
      });
  }

  get hasResolvedRefundRequest(): boolean {
    const status = this.order?.refund_request?.status;
    return status === 'approved' || status === 'rejected';
  }

  get isRefundModalReadonly(): boolean {
    return this.hasResolvedRefundRequest && !this.hasPendingRefundRequest;
  }

  get refundRecordStatusLabel(): string {
    const status = this.order?.refund_request?.status;
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Rejected';
    return 'Pending';
  }

  openRefundModal(): void {
    this.showRefundModal = true;
    this.actionError = null;
  }

  closeRefundModal(): void {
    this.showRefundModal = false;
  }

  approveRefundRequest(): void {
    if (!this.order || this.refundSaving) return;

    this.refundSaving = true;
    this.actionError = null;
    this.refundMessage = null;

    this.adminOrderService.approveRefund(this.order.order_id).subscribe({
      next: (response) => {
        this.order = response.data;
        this.refundMessage = 'Refund approved successfully.';
        this.refundSaving = false;
        this.showRefundModal = false;
        this.adminRefresh.refreshNotifications();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.actionError = err.error?.error || 'Failed to approve refund.';
        this.refundSaving = false;
        this.cdr.markForCheck();
      }
    });
  }

  openRejectModal(): void {
    this.rejectReason = '';
    this.rejectModalError = null;
    this.showRejectModal = true;
    this.showRefundModal = false;
  }

  closeRejectModal(): void {
    this.showRejectModal = false;
    this.rejectReason = '';
    this.rejectModalError = null;
  }

  onRejectReasonInput(value: string): void {
    this.rejectReason = value;
    if (this.rejectModalError) {
      this.rejectModalError = null;
    }
  }

  submitRejectRefund(): void {
    if (!this.order || this.refundSaving) return;

    const trimmed = this.rejectReason.trim();
    if (!trimmed) {
      this.rejectModalError = 'Please provide a rejection reason.';
      return;
    }

    this.refundSaving = true;
    this.rejectModalError = null;
    this.refundMessage = null;

    this.adminOrderService.rejectRefund(this.order.order_id, trimmed).subscribe({
      next: (response) => {
        this.order = response.data;
        this.refundMessage = 'Refund request rejected.';
        this.refundSaving = false;
        this.showRejectModal = false;
        this.rejectReason = '';
        this.rejectModalError = null;
        this.adminRefresh.refreshNotifications();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.rejectModalError = err.error?.error || 'Failed to reject refund.';
        this.refundSaving = false;
        this.cdr.markForCheck();
      }
    });
  }

  saveNote(): void {
    if (!this.order || this.noteSaving) return;

    const trimmed = this.noteText.trim();
    if (!trimmed) {
      this.actionError = 'Please enter a note before saving.';
      return;
    }

    this.noteSaving = true;
    this.actionError = null;
    this.noteMessage = null;

    this.adminOrderService.addInternalNote(this.order.order_id, trimmed).subscribe({
      next: (response) => {
        this.order = response.data;
        this.noteText = '';
        this.noteMessage = 'Internal note saved.';
        this.noteSaving = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.actionError = 'Failed to save note.';
        this.noteSaving = false;
        this.cdr.markForCheck();
      }
    });
  }

  refundReasonLabel(request: AdminOrderRefundRequest | null): string {
    if (!request?.reason) return '—';
    if (request.reason === 'Other' && request.other_reason) {
      return `Other: ${request.other_reason}`;
    }
    return request.reason;
  }

  isImageEvidence(url: string): boolean {
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('data:image/')) return true;
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
  }

  isVideoEvidence(url: string): boolean {
    if (!url) return false;
    if (url.startsWith('data:video/')) return true;
    return /\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(url);
  }

  evidenceFileName(url: string): string {
    if (!url) return 'File';
    if (url.startsWith('blob:')) return 'Uploaded file';
    try {
      const parts = url.split('/');
      return decodeURIComponent(parts[parts.length - 1].split('?')[0]) || url;
    } catch {
      return url;
    }
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  }

  formatNoteMeta(note: AdminInternalNote): string {
    const date = note.created_at
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }).format(new Date(note.created_at))
      : '—';
    return `${note.author || 'Admin'} · ${date}`;
  }

  formatPrice(amount: number, currency = 'USD'): string {
    if (currency === 'VND') {
      return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(
      amount
    );
  }

  statusLabel(status: AdminOrderStatus | string): string {
    const labels: Record<string, string> = {
      pending: 'Processing',
      processing: 'Processing',
      shipping: 'Shipping',
      delivered: 'Delivered',
      canceled: 'Cancelled',
      refund: 'Refund',
      pending_refund: 'Pending Refund',
      refund_rejected: 'Refund Rejected'
    };
    return labels[status] || status;
  }

  statusClass(status: string): string {
    if (status === 'pending' || status === 'processing') return 'status-badge--processing';
    if (status === 'shipping') return 'status-badge--shipping';
    if (status === 'delivered') return 'status-badge--delivered';
    if (status === 'canceled') return 'status-badge--cancelled';
    if (status === 'refund') return 'status-badge--refund';
    if (status === 'pending_refund') return 'status-badge--pending-refund';
    if (status === 'refund_rejected') return 'status-badge--refund-rejected';
    return 'status-badge--processing';
  }

  shippingAddressLines(): string[] {
    if (!this.order?.shipping_address) return [];
    return this.order.shipping_address.split('\n').filter(Boolean);
  }
}
