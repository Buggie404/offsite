import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector:'app-hero-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hero-banner.component.html',
  styleUrls: ['./hero-banner.component.scss']
})
export class HeroBannerComponent {}