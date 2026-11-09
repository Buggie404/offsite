import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideCalendar } from '@lucide/angular';

export function isProductDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number(day.slice(0, 4)) > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

@Component({
  selector: 'app-product-date-input', standalone: true, imports: [CommonModule, LucideCalendar],
  template: `
    <div class="date-control" [class.invalid]="!!error">
      <input type="text" placeholder="dd/mm/yyyy" inputmode="numeric" maxlength="10" autocomplete="off"
        [value]="displayValue" [disabled]="disabled" [attr.aria-label]="label" [attr.aria-invalid]="!!error"
        (input)="typeDate($any($event.target).value)" />
      <button type="button" [disabled]="disabled" [attr.aria-label]="'Open calendar for ' + label" (click)="openPicker(picker)">
        <svg lucideCalendar [size]="16" aria-hidden="true"></svg>
      </button>
      <input #picker class="native-picker" type="date" tabindex="-1" aria-hidden="true" [disabled]="disabled"
        [value]="isoValue" [attr.min]="min && isValid(min) ? min.slice(0, 10) : null" (change)="valueChange.emit(picker.value || null)" />
    </div>
    <small *ngIf="error" class="date-error" role="alert">{{ error }}</small>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 130px; }
    .date-control { position: relative; }
    input { box-sizing: border-box; width: 100%; height: 38px; padding: 0 36px 0 10px; border: 1px solid rgba(84,74,64,.3); border-radius: 5px; background: white; color: inherit; font: 400 13px/18px var(--font-body); }
    input:focus { outline: none; border-color: #7a9a68; box-shadow: 0 0 0 2px rgba(122,154,104,.16); }
    .invalid input { border-color: #c0392b; }
    button { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); display: grid; place-items: center; width: 26px; height: 28px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
    input:disabled { background: #f3efea; color: #847b72; }
    button:disabled { opacity: .45; cursor: default; }
    .native-picker { position: absolute; bottom: 0; left: 0; width: 1px; height: 1px; padding: 0; opacity: 0; pointer-events: none; }
    .date-error { display: block; margin-top: 4px; color: #c0392b; font: 400 11px/15px var(--font-body); }
  `]
})
export class ProductDateInputComponent {
  @Input() value: string | null = null;
  @Input() min: string | null = null;
  @Input() disabled = false;
  @Input() label = 'Date';
  @Output() valueChange = new EventEmitter<string | null>();
  isValid = isProductDate;
  get isoValue(): string { return isProductDate(this.value) ? this.value.slice(0, 10) : ''; }
  get displayValue(): string {
    const iso = this.isoValue;
    return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : this.value || '';
  }
  get error(): string {
    if (!this.value) return '';
    if (!isProductDate(this.value)) return 'Enter a valid date as dd/mm/yyyy.';
    return isProductDate(this.min) && this.isoValue < this.min.slice(0, 10) ? 'Date cannot precede the received date.' : '';
  }
  typeDate(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) { this.valueChange.emit(null); return; }
    const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : trimmed;
    this.valueChange.emit(isProductDate(iso) ? iso.slice(0, 10) : trimmed);
  }
  openPicker(picker: HTMLInputElement): void {
    if (this.disabled) return;
    try { picker.showPicker(); } catch { picker.click(); }
  }
}
