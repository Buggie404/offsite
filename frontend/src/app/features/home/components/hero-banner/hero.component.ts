// ─────────────────────────────────────────────────────────────
//  components/hero/hero.component.ts
// ─────────────────────────────────────────────────────────────

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.scss'],
})
export class HeroComponent {
  // Thay bằng đường dẫn ảnh thật khi có
    heroImage = 'assets/images/Background.png';

  // Text content — dễ swap sau này nếu CMS trả về
  heading   = 'Your café,';
  headingAccent = 'at home';
  body      = "We're building a world where the best café experience isn't somewhere you have to go — it's something you can always come back to, wherever you already are.";
  ctaPrimary   = 'Shop All Product';
  ctaSecondary = 'Take the Quiz';
}