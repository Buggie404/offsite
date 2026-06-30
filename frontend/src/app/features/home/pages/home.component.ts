import { Component } from '@angular/core';
import { CollectionComponent } from '../components/collection/collection.component';
import { BestSellerComponent } from '../components/best-seller/best-seller.component';
import { RecipeSectionComponent } from '../components/recipes/recipe-section.component';
import { HeroComponent } from '../components/hero-banner/hero.component';
import { BrandStoryComponent } from '../components/brand-story/brand-story.component';
import { CommunityComponent } from '../components/community/community.component';

// import thêm component mới ở đây

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CollectionComponent,
    BestSellerComponent,
    RecipeSectionComponent,
    HeroComponent,
    BrandStoryComponent,
    CommunityComponent
    // thêm vào đây
  ],
  templateUrl: './home.component.html',   // ← đổi từ template sang templateUrl
})
export class HomeComponent {}