import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideX } from '@lucide/angular';

export type ReportPenalty = 'warn' | 'suspend_3d' | 'suspend_7d';

export interface ReportPayload {
  reason: string;
  note: string;
  /** Staff mode only: the penalty applied right away. */
  penalty?: ReportPenalty;
}

@Component({
  selector: 'app-report-post-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideX],
  templateUrl: './report-post-modal.component.html',
  styleUrls: ['./report-post-modal.component.scss']
})
export class ReportPostModalComponent {
  @Input() authorUsername = '';
  @Input() postExcerpt = '';
  @Input() submitting = false;
  @Input() error = '';
  @Input() target: 'post' | 'comment' | 'account' = 'post';
  /** Staff reporting an account: choose the penalty and apply it now instead of queueing a report. */
  @Input() staffPenalty = false;

  @Output() cancel = new EventEmitter<void>();
  @Output() submitReport = new EventEmitter<ReportPayload>();

  // Values must match REPORT_REASONS in backend/src/models/PostReport.js.
  readonly reasons = [
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Inappropriate' },
    { value: 'off_topic', label: 'Off Topic' },
    { value: 'misleading', label: 'Misleading' },
    { value: 'other', label: 'Other' }
  ];

  // Same levels as Community reports (backend PENALTIES).
  readonly penalties: { value: ReportPenalty; label: string; hint: string }[] = [
    { value: 'warn', label: 'L1 · Warning', hint: 'Warning only, no limits' },
    { value: 'suspend_3d', label: 'L2 · Restrict 3 days', hint: 'No posting or commenting for 3 days' },
    { value: 'suspend_7d', label: 'L3 · Restrict 7 days', hint: 'No posting or commenting for 7 days' }
  ];

  reason = '';
  note = '';
  penalty: ReportPenalty | '' = '';
  private penaltyTouched = false;

  // Suggest the level the reason usually gets (misleading L2, inappropriate L3, others L1) until staff pick one.
  onReasonChange(): void {
    if (!this.staffPenalty || this.penaltyTouched) return;
    this.penalty = this.reason === 'inappropriate' ? 'suspend_7d' : this.reason === 'misleading' ? 'suspend_3d' : 'warn';
  }

  onPenaltyChange(): void {
    this.penaltyTouched = true;
  }

  get excerpt(): string {
    const text = (this.postExcerpt || '').replace(/\s+/g, ' ').trim();
    return text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  }

  // "Other" needs an explanation; the preset reasons speak for themselves.
  get noteRequired(): boolean {
    return this.reason === 'other';
  }

  get canSubmit(): boolean {
    return !!this.reason && !this.submitting && (!this.noteRequired || this.note.trim().length > 0)
      && (!this.staffPenalty || !!this.penalty);
  }

  onSubmit(): void {
    if (!this.canSubmit) return;
    this.submitReport.emit({
      reason: this.reason,
      note: this.note.trim(),
      ...(this.staffPenalty && this.penalty ? { penalty: this.penalty } : {})
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.submitting) this.cancel.emit();
  }
}
