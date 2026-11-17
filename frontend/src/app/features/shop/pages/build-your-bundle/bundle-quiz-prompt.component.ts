import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowRight, LucideX, LucideSparkles } from '@lucide/angular';

@Component({
  selector: 'app-bundle-quiz-prompt',
  standalone: true,
  imports: [RouterLink, LucideArrowRight, LucideX, LucideSparkles],
  templateUrl: './bundle-quiz-prompt.component.html',
  styleUrl: './bundle-quiz-prompt.component.scss'
})
export class BundleQuizPromptComponent implements AfterViewInit, OnDestroy {
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly dismiss = output<void>();
  private previousOverflow = '';

  ngAfterViewInit(): void {
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.dialog.nativeElement.showModal();
  }

  close(): void {
    this.dialog.nativeElement.close();
    this.dismiss.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target !== this.dialog.nativeElement) return;
    const bounds = this.dialog.nativeElement.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) this.close();
  }

  ngOnDestroy(): void {
    this.dialog.nativeElement.close();
    document.body.style.overflow = this.previousOverflow;
  }
}
