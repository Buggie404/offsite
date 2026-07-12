import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Directive({
  selector: '[appAnimateInView]',
  standalone: true,
})
export class AnimateInViewDirective implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private observer?: IntersectionObserver;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (
      !('IntersectionObserver' in window)
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || this.isRestoringSavedPagePosition()
    ) {
      this.element.nativeElement.classList.add('is-in-view');
      return;
    }

    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in-view');
          this.observer?.unobserve(entry.target);
        }
      },
      { threshold: 0.15 }
    );

    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private isRestoringSavedPagePosition(): boolean {
    const state = window.history.state;
    return this.isSavedScrollPosition(state?.homeScrollY)
      || this.isSavedScrollPosition(state?.productDetailScrollY);
  }

  private isSavedScrollPosition(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }
}
