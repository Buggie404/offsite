import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideLeaf, LucideCoffee, LucideSparkles, LucideDroplet, LucideDessert, LucideStar, LucideHeart } from '@lucide/angular';

@Component({
  selector:'app-hero-banner',
  standalone: true,
  imports: [CommonModule, LucideLeaf, LucideCoffee, LucideSparkles, LucideDroplet, LucideDessert, LucideStar, LucideHeart],
  templateUrl: './hero-banner.component.html',
  styleUrls: ['./hero-banner.component.scss']
})
export class HeroBannerComponent {}