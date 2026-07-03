import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  LucideSave,
  LucideChevronDown,
  LucideUndo2,
  LucideStickyNote,
  LucideXCircle
} from '@lucide/angular';
import { AdminOrderService } from '../../services/admin-order.service';
import {
  AdminInternalNote,
  AdminOrderDetail,
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
    LucideChevronDown,
    LucideUndo2,
    LucideStickyNote,
    LucideXCircle
  ],
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.scss'
})
export class OrderDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private adminOrderService = inject(AdminOrderService);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  order: AdminOrderDetail | null = null;
  loading = true;
  error: string | null = null;

  selectedStatus: AdminOrderStatusUpdate = 'processing';
  refundReason = '';
  noteText = '';

  statusSaving = false;
  refundSaving = false;
  noteSaving = false;

  statusMessage: string | null = null;
  refundMessage: string | null = null;
  noteMessage: string | null = null;
  actionError: string | null = null;

  readonly statusOptions: StatusOption[] = [
    { value: 'processing', label: 'Processing' },
    { value: 'shipping', label: 'Shipping' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'canceled', label: 'Cancelled' },
    { value: 'refund', label: 'Refund' }
  ];

  readonly refundReasons = [
    'Damaged item',
    'Wrong item received',
    'Order cancelled',
    'Other'
  ];

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const orderId = params.get('id');
      if (orderId) {
        this.loadOrder(orderId);
      }
    });
  }

  get orderId(): string {
    return this.order?.order_id || this.route.snapshot.paramMap.get('id') || '';
  }

  get itemCount(): number {
    return this.order?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;
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

    const isDelivered = status === 'delivered';
    const isShipping = status === 'shipping' || isDelivered;
    const isProcessed = ['processing', 'shipping', 'delivered', 'refund', 'canceled'].includes(status);

    return [
      {
        label: 'Delivered',
        done: isDelivered,
        time: isDelivered
          ? this.formatDateTime(this.order.delivered_at) || findHistoryTime('delivered') || '—'
          : 'Pending'
      },
      {
        label: 'Shipping',
        done: isShipping,
        time: isShipping ? findHistoryTime('shipping') || '—' : 'Pending'
      },
      {
        label: 'Processed',
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
    return this.showRefundProcessing || this.showRefunded || this.showCanceled;
  }

  get showRefundProcessing(): boolean {
    return this.order?.refund_request?.status === 'pending';
  }

  get showRefunded(): boolean {
    return (
      this.order?.refund_request?.status === 'approved' ||
      this.order?.order_status === 'refund' ||
      this.order?.payment_status === 'refunded'
    );
  }

  get showCanceled(): boolean {
    return this.order?.order_status === 'canceled' || !!this.order?.canceled_at;
  }

  loadOrder(orderId: string): void {
    this.loading = true;
    this.error = null;

    this.adminOrderService.getOrderById(orderId).subscribe({
      next: (response) => {
        this.order = response.data;
        this.selectedStatus = this.mapStatusToUpdate(this.order.order_status);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load order details. Please try again.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  saveStatus(): void {
    if (!this.order || this.statusSaving) return;

    this.statusSaving = true;
    this.actionError = null;
    this.statusMessage = null;

    this.adminOrderService
      .updateOrderStatus(this.order.order_id, this.selectedStatus, 'Status updated by admin')
      .subscribe({
        next: (response) => {
          this.order = response.data;
          this.selectedStatus = this.mapStatusToUpdate(this.order.order_status);
          this.statusMessage = 'Status saved. Customer notification queued.';
          this.statusSaving = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.actionError = 'Failed to update order status.';
          this.statusSaving = false;
          this.cdr.markForCheck();
        }
      });
  }

  approveRefund(): void {
    if (!this.order || this.refundSaving) return;

    if (!this.refundReason) {
      this.actionError = 'Please select a refund reason.';
      return;
    }

    this.refundSaving = true;
    this.actionError = null;
    this.refundMessage = null;

    this.adminOrderService.approveRefund(this.order.order_id, this.refundReason).subscribe({
      next: (response) => {
        this.order = response.data;
        this.selectedStatus = this.mapStatusToUpdate(this.order.order_status);
        this.refundMessage = 'Refund approved successfully.';
        this.refundSaving = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.actionError = 'Failed to approve refund.';
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
      refund: 'Refund'
    };
    return labels[status] || status;
  }

  statusClass(status: string): string {
    if (status === 'pending' || status === 'processing') return 'status-badge--processing';
    if (status === 'shipping') return 'status-badge--shipping';
    if (status === 'delivered') return 'status-badge--delivered';
    if (status === 'canceled') return 'status-badge--cancelled';
    if (status === 'refund') return 'status-badge--refund';
    return 'status-badge--processing';
  }

  shippingAddressLines(): string[] {
    if (!this.order?.shipping_address) return [];
    return this.order.shipping_address.split('\n').filter(Boolean);
  }

  private mapStatusToUpdate(status: AdminOrderStatus): AdminOrderStatusUpdate {
    if (status === 'pending') return 'processing';
    if (status === 'canceled') return 'canceled';
    return status as AdminOrderStatusUpdate;
  }
}
