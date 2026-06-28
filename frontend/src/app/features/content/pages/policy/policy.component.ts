import { Component, OnInit, AfterViewInit, OnDestroy, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LucidePackage,
  LucideRefreshCw,
  LucideLock,
  LucideHeart,
  LucideShieldCheck,
  LucideRotateCcw,
  LucideSparkles,
  LucideTruck
} from '@lucide/angular';

@Component({
  selector: 'app-policy',
  standalone: true,
  imports: [
    CommonModule,
    LucidePackage,
    LucideRefreshCw,
    LucideLock,
    LucideHeart,
    LucideShieldCheck,
    LucideRotateCcw,
    LucideSparkles,
    LucideTruck
  ],
  templateUrl: './policy.component.html',
  styleUrl: './policy.component.scss'
})
export class PolicyComponent implements OnInit, AfterViewInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  activeSection = 'shipping';

  sections = [
    { id: 'shipping', label: 'Shipping Policy', icon: 'package' },
    { id: 'returns', label: 'Returns & Exchanges', icon: 'refresh' },
    { id: 'privacy', label: 'Privacy Policy', icon: 'lock' },
    { id: 'terms', label: 'Terms of Service', icon: 'heart' }
  ];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.route.fragment.subscribe(fragment => {
        if (fragment) {
          const match = this.sections.some(s => s.id === fragment);
          if (match) {
            this.activeSection = fragment;
          }
        }
      });
    }
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('scroll', this.boundScrollHandler, { passive: true });
      this.boundScrollHandler();
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('scroll', this.boundScrollHandler);
    }
  }

  private boundScrollHandler = (): void => {
    let bestSection = this.sections[0].id;
    let bestVisibleHeight = 0;

    for (const section of this.sections) {
      const el = document.getElementById(section.id);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(window.innerHeight, rect.bottom);
      const visibleHeight = visibleBottom - visibleTop;

      if (visibleHeight > bestVisibleHeight) {
        bestVisibleHeight = visibleHeight;
        bestSection = section.id;
      }
    }

    if (this.activeSection !== bestSection) {
      this.activeSection = bestSection;
      this.cdr.detectChanges();
    }
  };

  scrollToSection(sectionId: string, updateUrl = true): void {
    this.activeSection = sectionId;
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

      if (updateUrl) {
        setTimeout(() => {
          history.replaceState(null, '', `#${sectionId}`);
        }, 700);
      }
    }
  }
}
