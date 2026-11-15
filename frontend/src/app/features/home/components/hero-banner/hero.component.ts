// ─────────────────────────────────────────────────────────────
//  components/hero/hero.component.ts
//  Hero carousel: 3 banners in one frame, auto-advances every 5s,
//  swipe / scroll horizontally, or use the arrows and dots.
// ─────────────────────────────────────────────────────────────

import { LucideChevronLeft, LucideChevronRight, LucideSparkle } from '@lucide/angular';
import { AfterViewInit, Component, ElementRef, OnDestroy, PLATFORM_ID, ViewChild, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HeroDnaSlideComponent } from './hero-dna-slide.component';

const AUTOPLAY_MS = 5000;

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule, RouterLink, HeroDnaSlideComponent, LucideChevronLeft, LucideChevronRight, LucideSparkle],
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  @ViewChild('track') private trackRef?: ElementRef<HTMLElement>;
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly slides = ['Your café, at home', 'Find your Ritual DNA', 'Holiday sale'];
  readonly active = signal(0);
  readonly paused = signal(false);
  readonly autoplay = signal(false);

  // Banner 1
  heroImage = 'assets/images/homepage-hero-flatlay.webp';
  heading   = 'Your café,';
  headingAccent = 'at home';
  body      = "We're building a world where the best café experience isn't somewhere you have to go — it's something you can always come back to, wherever you already are.";
  ctaPrimary   = 'Shop Best Sellers';
  ctaSecondary = 'TAKE YOUR STARTER QUIZ';

  // Banner 3
  holidayImage = 'assets/images/homepage-hero-holiday.webp';

  private timer?: ReturnType<typeof setTimeout>;
  private hovering = false;
  private focused = false;
  private readonly onVisibility = () => this.updatePaused();

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    // Respect reduced-motion: no auto-advance, manual navigation only.
    this.autoplay.set(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    if (this.isBrowser) document.removeEventListener('visibilitychange', this.onVisibility);
  }

  go(index: number): void {
    const track = this.trackRef?.nativeElement;
    if (!track) return;
    const next = (index + this.slides.length) % this.slides.length;
    track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    this.active.set(next);
    this.schedule();
  }

  onScroll(): void {
    const track = this.trackRef?.nativeElement;
    if (!track || !track.clientWidth) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== this.active()) {
      this.active.set(index);
      this.schedule();
    }
  }

  setHover(value: boolean): void { this.hovering = value; this.updatePaused(); }
  setFocus(value: boolean): void { this.focused = value; this.updatePaused(); }

  /** Restart the 5s countdown (also used when the visitor interacts inside a slide). */
  schedule(): void {
    clearTimeout(this.timer);
    if (!this.isBrowser || !this.autoplay() || this.paused()) return;
    this.timer = setTimeout(() => this.go(this.active() + 1), AUTOPLAY_MS);
  }

  private updatePaused(): void {
    this.paused.set(this.hovering || this.focused || document.hidden);
    this.schedule();
  }
}
