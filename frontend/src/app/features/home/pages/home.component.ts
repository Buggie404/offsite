import { Component } from '@angular/core';
import { CollectionComponent } from '../components/collection/collection.component';
import { BestSellerComponent } from '../components/best-seller/best-seller.component';
import { RecipeSectionComponent } from '../components/recipes/recipe-section.component';

// import { HeroBannerComponent } from '../components/hero-banner/hero-banner.component';
// import thêm component mới ở đây

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CollectionComponent,
    BestSellerComponent,
    RecipeSectionComponent,
    // HeroBannerComponent,
    // thêm vào đây
  ],
  templateUrl: './home.component.html',   // ← đổi từ template sang templateUrl
  // styleUrl: './home.component.scss'
})
export class HomeComponent {}