import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { LucidePlay, LucideX } from '@lucide/angular';
import { brewResumeMessage } from '../brew-coach/brew-progress';

@Component({
  selector: 'app-brew-resume-modal',
  standalone: true,
  imports: [CommonModule, LucidePlay, LucideX],
  templateUrl: './brew-resume-modal.component.html',
  styleUrl: './brew-resume-modal.component.scss',
})
export class BrewResumeModalComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private previousBodyOverflow = '';
  private previousHtmlOverflow = '';

  @Input() recipeTitle = '';
  @Input() stepNumber = 1;
  @Input() secondsLeft: number | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() continued = new EventEmitter<void>();
  @Output() restarted = new EventEmitter<void>();

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

  get message(): string {
    return brewResumeMessage(this.recipeTitle, this.stepNumber, this.secondsLeft);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onBackdropClick(): void {
    this.closed.emit();
  }

  onClose(): void {
    this.closed.emit();
  }

  onContinue(): void {
    this.continued.emit();
  }

  onRestart(): void {
    this.restarted.emit();
  }
}
