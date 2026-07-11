import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AnimateInViewDirective } from '../../../../shared/directives/animate-in-view.directive';
import { ParallaxDirective } from '../../../../shared/directives/parallax.directive';

@Component({
  selector: 'app-brand-story',
  standalone: true,
  imports: [CommonModule, RouterLink, AnimateInViewDirective, ParallaxDirective],
  templateUrl: './brand-story.component.html',
  styleUrls: ['./brand-story.component.scss'],
})
export class BrandStoryComponent {
  eyebrow = 'OUR STORY';

  heading = 'The best cup always happens somewhere else. Until now.';

  body =
    'Offsite started from a simple frustration: why does the best cup always happen somewhere else? We go to the café not just for the coffee — but for the ritual. The pause. The steam. The quiet moment that resets everything. We decided to bring that home.';

  ctaLabel = 'READ OUR STORY';
  ctaLink = '/about-us';

  /**
   * Placeholder image — replace with real asset path once available.
   * e.g. 'assets/images/brand-story-hero.jpg'
   */
  heroImage = 'assets/images/hero-image.png';
}
