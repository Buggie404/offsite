import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-promo-ticker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './promo-ticker.component.html',
  styleUrls: ['./promo-ticker.component.scss']
})
export class PromoTickerComponent {
  readonly promoItems = [
    'CEREMONIAL GRADE MATCHA',
    'FREE SHIPPING OVER $200',
    'UJI - JAPAN',
    'BUNDLE & SAVE 20%',
    'DAILY CAFE RITUALS',
    'MATCHA TOOLS & WHISKS',
    'BUILD YOUR OWN BUNDLE',
    'BREW BETTER AT HOME',
    'EXPLORE OUR COMMUNITY'
  ];
}
