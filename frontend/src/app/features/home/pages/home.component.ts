import { AfterViewInit, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CollectionComponent } from '../components/collection/collection.component';
import { BestSellerComponent } from '../components/best-seller/best-seller.component';
import { RecipeSectionComponent } from '../components/recipes/recipe-section.component';
import { HeroComponent } from '../components/hero-banner/hero.component';
import { PromoTickerComponent } from '../components/promo-ticker/promo-ticker.component';
import { BrandStoryComponent } from '../components/brand-story/brand-story.component';
import { CommunityComponent } from '../components/community/community.component';
import { BackToTopComponent } from '../../../shared/components/back-to-top/back-to-top.component';

// import thêm component mới ở đây

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CollectionComponent,
    BestSellerComponent,
    RecipeSectionComponent,
    HeroComponent,
    PromoTickerComponent,
    BrandStoryComponent,
    CommunityComponent,
    BackToTopComponent
    // thêm vào đây
  ],
  templateUrl: './home.component.html',   // ← đổi từ template sang templateUrl
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private routerEventsSubscription?: Subscription;
  private scrollRestoreTimers: Array<ReturnType<typeof setTimeout>> = [];
  private savedScrollY: number | null = null;

  readonly recipeDetailEntryState = { contentEntrySource: 'homepage' };

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.savedScrollY = this.getSavedScrollPosition();
    this.routerEventsSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        this.saveScrollPosition();
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.savedScrollY === null || !isPlatformBrowser(this.platformId)) return;

    const scrollY = this.savedScrollY;
    const restore = (): void => window.scrollTo({ top: scrollY, behavior: 'auto' });

    requestAnimationFrame(() => {
      restore();
      [100, 300, 700].forEach(delay => {
        this.scrollRestoreTimers.push(setTimeout(restore, delay));
      });
    });
  }

  ngOnDestroy(): void {
    this.routerEventsSubscription?.unsubscribe();
    this.scrollRestoreTimers.forEach(timer => clearTimeout(timer));
  }

  private saveScrollPosition(): void {
    window.history.replaceState(
      { ...window.history.state, homeScrollY: window.scrollY },
      '',
      window.location.href
    );
  }

  private getSavedScrollPosition(): number | null {
    const scrollY = window.history.state?.homeScrollY;
    return typeof scrollY === 'number' && Number.isFinite(scrollY)
      ? Math.max(0, scrollY)
      : null;
  }
}
