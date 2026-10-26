import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideCheck, LucideChevronDown, LucideVolume2, LucideX } from '@lucide/angular';

export interface BrewPrepCandidate {
  id: string;
  label: string;
}

export interface BrewPrepItem {
  key: string;
  name: string;
  optional: boolean;
  amount: string;
  checked: boolean;
  pantryLabel: string;
  deductLabel: string;
  candidates: BrewPrepCandidate[];
  selectedId: string;
}

@Component({
  selector: 'app-brew-prep-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideCheck, LucideChevronDown, LucideVolume2, LucideX],
  templateUrl: './brew-prep-modal.component.html',
  styleUrl: './brew-prep-modal.component.scss',
})
export class BrewPrepModalComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private previousBodyOverflow = '';
  private previousHtmlOverflow = '';

  @Input() items: BrewPrepItem[] = [];
  @Input() stepCount = 0;
  @Input() prepMinutes = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() toggled = new EventEmitter<string>();
  @Output() started = new EventEmitter<void>();
  @Output() pantrySelected = new EventEmitter<{ name: string; id: string }>();

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    document.body.style.overflow = this.previousBodyOverflow;
    document.documentElement.style.overflow = this.previousHtmlOverflow;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onBackdropClick(): void {
    this.closed.emit();
  }

  onToggle(key: string): void {
    this.toggled.emit(key);
  }

  onPantrySelect(item: BrewPrepItem, id: string): void {
    if (!id || id === item.selectedId) return;
    this.pantrySelected.emit({ name: item.name, id });
  }

  trackItem(_index: number, item: BrewPrepItem): string {
    return item.key;
  }

  trackCandidate(_index: number, candidate: BrewPrepCandidate): string {
    return candidate.id;
  }

  onStart(): void {
    this.started.emit();
  }

  get stepLabel(): string {
    return this.stepCount === 1 ? 'step' : 'steps';
  }
}
