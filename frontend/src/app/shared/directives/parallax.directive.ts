import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ParallaxScrollService } from '../services/parallax-scroll.service';

/**
 * Moves the host element vertically as the page scrolls, writing the
 * offset into the `--parallax-y` CSS custom property so component
 * stylesheets stay in control of the rest of the `transform` (e.g. an
 * existing `rotate()` on a decorative shape).
 *
 * Speed is relative to how far the element sits from the viewport
 * centre — 0 is static, positive drifts with scroll direction,
 * negative drifts against it. Small values (0.05–0.25) read as a
 * subtle background float rather than a fast-moving layer.
 */
@Directive({
  selector: '[appParallax]',
  standalone: true,
})
export class ParallaxDirective implements AfterViewInit, OnDestroy {
  @Input('appParallax') speed = 0.15;

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly parallaxScroll = inject(ParallaxScrollService);
  private unregister?: () => void;
  private observer?: IntersectionObserver;
  private isInView = false;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        ([entry]) => {
          this.isInView = entry.isIntersecting;
        },
        { rootMargin: '25% 0px' }
      );
      this.observer.observe(this.element);
    } else {
      this.isInView = true;
    }

    this.unregister = this.parallaxScroll.register(() => this.update());
  }

  private update(): void {
    if (!this.isInView) return;

    const rect = this.element.getBoundingClientRect();
    const viewportCenter = window.innerHeight / 2;
    const elementCenter = rect.top + rect.height / 2;
    const offset = (viewportCenter - elementCenter) * this.speed;

    this.element.style.setProperty('--parallax-y', `${offset.toFixed(2)}px`);
  }

  ngOnDestroy(): void {
    this.unregister?.();
    this.observer?.disconnect();
  }
}
