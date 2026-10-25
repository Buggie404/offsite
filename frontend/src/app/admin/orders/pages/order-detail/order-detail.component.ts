import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { interval } from 'rxjs';
import {
  LucideSave,
  LucideStickyNote,
  LucideXCircle,
  LucideAlertCircle,
  LucideEye,
  LucideCheck,
  LucideX,
  LucideUndo2,
  LucideRepeat,
  LucideInfo,
  LucidePackageX,
  LucideTruck
} from '@lucide/angular';
import { OrderTypeBadgeComponent } from '../../../../shared/components/order-type-badge/order-type-badge.component';
import { getFrequencyLabel, getSubscriptionLineLabel } from '../../../../shared/utils/order-type';
import { AdminOrderService } from '../../services/admin-order.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminRefreshService } from '../../../shared/services/admin-refresh.service';
import { OrderSocketService } from '../../../../core/services/order-socket.service';
import {
  AdminInternalNote,
  AdminOrderDetail,
  AdminOrderLineItem,
  AdminOrderRefundItem,
  AdminOrderRefundRequest,
  AdminOrderStatus,
  AdminOrderStatusHistoryEntry,
  AdminOrderRitualBox,
  AdminOrderStatusUpdate
} from '../../models/admin-order.model';
import { isMeaningfulVariantLabel } from '../../../../shared/utils/variant-label';

interface StatusOption {
  value: AdminOrderStatusUpdate;
  label: string;
  hint: string;
  /** Asks for a reason first; it goes to the order history, the customer and the activity log. */
  requiresReason?: boolean;
  danger?: boolean;
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
    LucideRepeat,
    OrderTypeBadgeComponent,
    LucideSave,
    LucideStickyNote,
    LucideXCircle,
    LucideAlertCircle,
    LucideEye,
    LucideCheck,
    LucideX,
    LucideUndo2,
    LucideInfo,
    LucidePackageX,
    LucideTruck
  ],
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.scss'
})
export class OrderDetailComponent implements OnInit {
  /** Hide empty / "Default" variant labels (products without real variants). */
  readonly isMeaningfulVariantLabel = isMeaningfulVariantLabel;

  readonly getSubscriptionLineLabel = getSubscriptionLineLabel;

  ritualBoxProduct(box: AdminOrderRitualBox): string {
    const name = [box.product_name, box.variant_label].filter(Boolean).join(' ');
    return box.quantity > 1 ? `${box.quantity} × ${name}` : name;
  }

  ritualBoxFrequency(box: AdminOrderRitualBox): string {
    return getFrequencyLabel(box.frequency_days).toLowerCase();
  }

  ritualBoxNextStep(box: AdminOrderRitualBox): string {
    switch (box.status) {
      case 'active':
        return box.next_charge_at
          ? `next delivery ${new Date(box.next_charge_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : 'active';
      case 'paused': return 'paused';
      case 'payment_failed': return 'payment failed';
      case 'suspended': return 'suspended';
      default: return 'cancelled';
    }
  }

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private adminOrderService = inject(AdminOrderService);
  private adminAuth = inject(AdminAuthService);
  private adminRefresh = inject(AdminRefreshService);
  private orderSocketService = inject(OrderSocketService);
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
  showApproveConfirmModal = false;
  showEvidencePreview = false;
  previewEvidenceUrl: string | null = null;
  previewEvidenceType: 'image' | 'video' | null = null;
  rejectReason = '';
  rejectModalError: string | null = null;

  /** Status change waiting on a reason (delivery failed / cancel a failed delivery). */
  reasonStatusOption: StatusOption | null = null;
  statusReason = '';
  statusReasonError: string | null = null;

  showOutOfStockModal = false;
  outOfStockSelection = new Set<string>();
  outOfStockReason = '';
  outOfStockError: string | null = null;
  outOfStockSaving = false;
  private statusMessageTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.clearStatusMessageTimer());

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const orderId = params.get('id');
      if (orderId) {
        this.clearActionFeedback();
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

    this.orderSocketService.joinAdminRoom();
    this.orderSocketService.orderUpdated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        const currentId = this.orderId;
        if (currentId && event && event.order_id === currentId) {
          this.loadOrder(currentId, true);
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

    switch (this.order.order_status) {
      case 'pending':
      case 'processing':
        return [{
          value: 'shipping',
          label: 'Shipping',
          hint: 'Mark this order as shipped. The customer can view updates on Order Tracking after entering their order number.'
        }];
      case 'shipping':
        return [{
          value: 'delivery_failed',
          label: 'Delivery failed',
          hint: 'The carrier could not deliver. The customer is notified with your reason.',
          requiresReason: true
        }];
      case 'delivery_failed':
        return [
          {
            value: 'shipping',
            label: 'Ship again',
            hint: 'Send the order out for another delivery attempt.'
          },
          {
            value: 'canceled',
            label: 'Cancel order',
            hint: this.order.payment_status === 'paid'
              ? 'Cancel and refund the full payment. Stock goes back on the shelf.'
              : 'Cancel the order. Stock goes back on the shelf.',
            requiresReason: true,
            danger: true
          }
        ];
      default:
        return [];
    }
  }

  get canManageOrders(): boolean {
    const role = this.adminAuth.getAdminRole();
    return role === 'admin_cc' || role === 'qlsp';
  }

  get canUpdateStatus(): boolean {
    return this.canManageOrders && this.statusOptions.length > 0;
  }

  get statusUpdateDisabledReason(): string | null {
    if (!this.canManageOrders) return 'Your role has read-only access to orders.';
    if (!this.order || this.canUpdateStatus) return null;

    const status = this.order.order_status;

    switch (status) {
      case 'delivered':
        return 'This order has already been delivered.';
      case 'pending_refund':
        return 'A refund request is pending. Approve or reject it before updating shipment status.';
      case 'refund':
        return 'This order has been refunded.';
      case 'refund_rejected':
        return 'The refund request was rejected. This order has already completed delivery.';
      case 'canceled':
        return 'This order was cancelled.';
      default:
        return `Status "${this.statusLabel(status)}" cannot be updated from the admin portal.`;
    }
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
      status === 'shipping' || status === 'delivery_failed' || reachedDelivered;
    const isProcessed = ['processing', 'shipping', 'delivery_failed', 'delivered', 'refund', 'canceled', 'pending_refund', 'refund_rejected'].includes(status);

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
      this.deliveryFailures.length > 0 ||
      this.showCanceled
    );
  }

  /** Every failed delivery attempt, newest first (a redelivered order keeps its history). */
  get deliveryFailures(): AdminOrderStatusHistoryEntry[] {
    return [...(this.order?.status_history || [])].filter((h) => h.status === 'delivery_failed').reverse();
  }

  /** Why the order was cancelled, when it was cancelled by staff or the system with a note. */
  get cancelNote(): string | null {
    const entry = [...(this.order?.status_history || [])].reverse().find((h) => h.status === 'canceled');
    return entry?.note || null;
  }

  get outOfStockItems(): AdminOrderLineItem[] {
    return (this.order?.items || []).filter((item) => item.out_of_stock);
  }

  get canReportOutOfStock(): boolean {
    return this.canManageOrders && this.order?.order_status === 'processing';
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
      this.clearActionFeedback();
    }

    this.adminOrderService.getOrderById(orderId).subscribe({
      next: (response) => {
        this.order = response.data;
        this.selectedStatus = this.statusOptions[0]?.value || 'processing';
        this.statusSaving = false;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (!silent) {
          if (err?.status === 404) {
            void this.router.navigateByUrl('/admin/404', { skipLocationChange: true });
          } else {
            this.error = 'Failed to load order details. Please try again.';
          }
        }
        this.statusSaving = false;
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  chooseStatus(option: StatusOption): void {
    if (!this.canManageOrders || !this.order || this.statusSaving) return;
    if (option.requiresReason) {
      this.reasonStatusOption = option;
      this.statusReason = '';
      this.statusReasonError = null;
      return;
    }
    this.saveStatus(option);
  }

  closeStatusReasonModal(): void {
    this.reasonStatusOption = null;
    this.statusReason = '';
    this.statusReasonError = null;
  }

  submitStatusReason(): void {
    const option = this.reasonStatusOption;
    if (!option) return;
    const reason = this.statusReason.trim();
    if (!reason) {
      this.statusReasonError = 'Please enter a reason.';
      return;
    }
    this.saveStatus(option, reason);
  }

  saveStatus(option: StatusOption, reason?: string): void {
    if (!this.canManageOrders || !this.order || this.statusSaving || !this.canUpdateStatus) return;

    this.statusSaving = true;
    this.actionError = null;
    this.statusMessage = null;

    this.adminOrderService
      .updateOrderStatus(this.order.order_id, option.value, 'Status updated by admin', reason)
      .subscribe({
        next: (response) => {
          this.order = response.data;
          this.selectedStatus = this.statusOptions[0]?.value || 'processing';
          this.statusSaving = false;
          this.closeStatusReasonModal();
          this.showTransientStatusMessage(`Status updated to ${this.statusLabel(response.data.order_status)}.`);
          this.adminRefresh.refreshNotifications();
          this.cdr.markForCheck();
        },
        error: (err) => {
          const message = err.error?.error || 'Failed to update order status.';
          if (this.reasonStatusOption) {
            this.statusReasonError = message;
          } else {
            this.actionError = message;
          }
          this.statusSaving = false;
          this.cdr.markForCheck();
        }
      });
  }

  lineKey(item: { product_id: string; variant_id: string }): string {
    return `${item.product_id}:${item.variant_id}`;
  }

  openOutOfStockModal(): void {
    if (!this.canReportOutOfStock) return;
    this.outOfStockSelection = new Set();
    this.outOfStockReason = '';
    this.outOfStockError = null;
    this.showOutOfStockModal = true;
  }

  closeOutOfStockModal(): void {
    this.showOutOfStockModal = false;
    this.outOfStockError = null;
  }

  toggleOutOfStockLine(item: AdminOrderLineItem, checked: boolean): void {
    const key = this.lineKey(item);
    if (checked) this.outOfStockSelection.add(key);
    else this.outOfStockSelection.delete(key);
    this.outOfStockError = null;
  }

  submitOutOfStock(): void {
    if (!this.order || this.outOfStockSaving) return;
    const items = this.order.items
      .filter((item) => this.outOfStockSelection.has(this.lineKey(item)))
      .map((item) => ({ product_id: item.product_id, variant_id: item.variant_id }));
    if (!items.length) {
      this.outOfStockError = 'Select at least one line that is out of stock.';
      return;
    }

    this.outOfStockSaving = true;
    this.adminOrderService
      .markOutOfStock(this.order.order_id, items, this.outOfStockReason.trim() || undefined)
      .subscribe({
        next: (response) => {
          this.order = response.data;
          this.outOfStockSaving = false;
          this.showOutOfStockModal = false;
          this.showTransientStatusMessage('Order cancelled: items out of stock. The customer has been notified.');
          this.adminRefresh.refreshNotifications();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.outOfStockError = err.error?.error || 'Failed to update the order.';
          this.outOfStockSaving = false;
          this.cdr.markForCheck();
        }
      });
  }

  get hasResolvedRefundRequest(): boolean {
    const status = this.order?.refund_request?.status;
    return status === 'approved' || status === 'rejected';
  }

  get isRefundModalReadonly(): boolean {
    return !this.canManageOrders || (this.hasResolvedRefundRequest && !this.hasPendingRefundRequest);
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
    this.closeEvidencePreview();
    this.showRefundModal = false;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.reasonStatusOption) {
      this.closeStatusReasonModal();
      return;
    }
    if (this.showOutOfStockModal) {
      this.closeOutOfStockModal();
      return;
    }
    if (this.showApproveConfirmModal) {
      this.closeApproveConfirmModal();
      return;
    }

    if (this.showEvidencePreview) {
      this.closeEvidencePreview();
    }
  }

  openApproveConfirmModal(): void {
    if (!this.canManageOrders || !this.order || this.refundSaving || this.isRefundModalReadonly) {
      return;
    }

    this.showApproveConfirmModal = true;
    this.actionError = null;
  }

  closeApproveConfirmModal(): void {
    this.showApproveConfirmModal = false;
  }

  confirmApproveRefund(): void {
    this.showApproveConfirmModal = false;
    this.approveRefundRequest();
  }

  approveRefundRequest(): void {
    if (!this.canManageOrders || !this.order || this.refundSaving) return;

    this.refundSaving = true;
    this.actionError = null;
    this.refundMessage = null;

    this.adminOrderService.approveRefund(this.order.order_id).subscribe({
      next: (response) => {
        this.order = response.data;
        this.refundMessage = 'Refund approved successfully.';
        this.refundSaving = false;
        this.showApproveConfirmModal = false;
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
    if (!this.canManageOrders) return;
    this.closeApproveConfirmModal();
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
    if (!this.canManageOrders || !this.order || this.refundSaving) return;

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
    if (!this.canManageOrders || !this.order || this.noteSaving) return;

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

  get refundLineItemCount(): number {
    return this.activeRefundRequest?.refund_item?.length || 0;
  }

  get orderLineItemCount(): number {
    return this.order?.items.length || 0;
  }

  isPartialRefundRequest(): boolean {
    if (!this.order || !this.activeRefundRequest?.refund_item?.length) {
      return false;
    }

    const refundKeys = new Set(
      this.activeRefundRequest.refund_item.map((item) => this.refundItemKey(item))
    );

    if (refundKeys.size < this.order.items.length) {
      return true;
    }

    return this.activeRefundRequest.refund_item.some((refundItem) => {
      const orderItem = this.order!.items.find(
        (item) =>
          item.product_id === refundItem.product_id && item.variant_id === refundItem.variant_id
      );
      return orderItem ? refundItem.quantity < orderItem.quantity : false;
    });
  }

  refundItemsSubtotal(): number {
    return (
      this.activeRefundRequest?.refund_item?.reduce((sum, item) => sum + (item.subtotal || 0), 0) ||
      0
    );
  }

  orderItemsNotInRefund(): AdminOrderLineItem[] {
    if (!this.order?.items.length || !this.activeRefundRequest?.refund_item?.length) {
      return [];
    }

    const refundKeys = new Set(
      this.activeRefundRequest.refund_item.map((item) => this.refundItemKey(item))
    );

    return this.order.items.filter(
      (item) => !refundKeys.has(`${item.product_id}:${item.variant_id}`)
    );
  }

  refundItemImageUrl(item: AdminOrderRefundItem): string | null {
    if (item.image?.url) {
      return item.image.url;
    }

    const orderItem = this.order?.items.find(
      (line) => line.product_id === item.product_id && line.variant_id === item.variant_id
    );

    return orderItem?.image_url || null;
  }

  private refundItemKey(item: { product_id: string; variant_id: string }): string {
    return `${item.product_id}:${item.variant_id}`;
  }

  isEvidenceUnavailable(url: string): boolean {
    return Boolean(url?.startsWith('blob:'));
  }

  isImageEvidence(url: string): boolean {
    if (!url || this.isEvidenceUnavailable(url)) return false;
    if (url.startsWith('data:image/')) return true;
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url)) return true;
    return /\/image\/upload\//i.test(url);
  }

  isVideoEvidence(url: string): boolean {
    if (!url || this.isEvidenceUnavailable(url)) return false;
    if (url.startsWith('data:video/')) return true;
    if (/\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(url)) return true;
    return /\/video\/upload\//i.test(url);
  }

  evidenceFileName(url: string): string {
    if (!url) return 'File';
    if (url.startsWith('blob:')) return 'Uploaded file';
    if (url.startsWith('data:image/')) return 'Evidence image';
    if (url.startsWith('data:video/')) return 'Evidence video';
    try {
      const parts = url.split('/');
      return decodeURIComponent(parts[parts.length - 1].split('?')[0]) || url;
    } catch {
      return url;
    }
  }

  openEvidencePreview(url: string): void {
    if (this.isEvidenceUnavailable(url)) {
      return;
    }

    if (this.isImageEvidence(url) || this.isVideoEvidence(url)) {
      this.previewEvidenceUrl = url;
      this.previewEvidenceType = this.isVideoEvidence(url) ? 'video' : 'image';
      this.showEvidencePreview = true;
      return;
    }

    if (/^https?:\/\//i.test(url) && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  closeEvidencePreview(): void {
    this.showEvidencePreview = false;
    this.previewEvidenceUrl = null;
    this.previewEvidenceType = null;
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
      delivery_failed: 'Delivery Failed',
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
    if (status === 'delivery_failed') return 'status-badge--delivery-failed';
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

  private clearActionFeedback(): void {
    this.clearStatusMessageTimer();
    this.statusMessage = null;
    this.actionError = null;
    this.refundMessage = null;
  }

  private clearStatusMessageTimer(): void {
    if (this.statusMessageTimer) {
      clearTimeout(this.statusMessageTimer);
      this.statusMessageTimer = null;
    }
  }

  private showTransientStatusMessage(message: string): void {
    this.clearStatusMessageTimer();
    this.statusMessage = message;
    this.statusMessageTimer = setTimeout(() => {
      this.statusMessage = null;
      this.statusMessageTimer = null;
      this.cdr.markForCheck();
    }, 4000);
  }
}
