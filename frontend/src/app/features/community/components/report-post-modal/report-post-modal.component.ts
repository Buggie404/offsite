import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideX } from '@lucide/angular';

export interface ReportPayload {
  reason: string;
  note: string;
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

  reason = '';
  note = '';

  get excerpt(): string {
    const text = (this.postExcerpt || '').replace(/\s+/g, ' ').trim();
    return text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
  }

  // "Other" needs an explanation; the preset reasons speak for themselves.
  get noteRequired(): boolean {
    return this.reason === 'other';
  }

  get canSubmit(): boolean {
    return !!this.reason && !this.submitting && (!this.noteRequired || this.note.trim().length > 0);
  }

  onSubmit(): void {
    if (!this.canSubmit) return;
    this.submitReport.emit({ reason: this.reason, note: this.note.trim() });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.submitting) this.cancel.emit();
  }
}
