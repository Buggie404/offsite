// ─────────────────────────────────────────────────────────────
//  components/hero/hero.component.ts
// ─────────────────────────────────────────────────────────────

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
})
export class HeroComponent {
  // Thay bằng đường dẫn ảnh thật khi có
  heroImage = 'assets/images/homepage-hero-editorial.png';

  // Text content — dễ swap sau này nếu CMS trả về
  heading   = 'Your café,';
  headingAccent = 'at home';
  body      = "We're building a world where the best café experience isn't somewhere you have to go — it's something you can always come back to, wherever you already are.";
  ctaPrimary   = 'Shop Best Sellers';
  ctaSecondary = 'Build Your Bundle';
}
