
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommunityRoutingModule } from './community-routing-module';

// import { FeedComponent } from './pages/feed/feed.component';
// import { HeroBannerComponent } from './components/hero-banner/hero-banner.component';
// import { FeedToolbarComponent } from './components/feed-toolbar/feed-toolbar.component';
// import { PostCardComponent } from './components/post-card/post-card.component';
// // import { CreatePostModalComponent } from './components/create-post-modal/create-post-modal.component';
// // import { CreateRecipeModalComponent } from './components/create-recipe-modal/create-recipe-modal.component';

// @NgModule({
//   declarations: [
//     FeedComponent,
//     HeroBannerComponent,
//     FeedToolbarComponent,
//     PostCardComponent,
//     // CreatePostModalComponent,
//     // CreateRecipeModalComponent
//   ],
//   imports: [
//     CommonModule,
//     CommunityRoutingModule
//   ]
// })
@NgModule({
  imports: [
    CommonModule,
    CommunityRoutingModule
  ]
})
export class CommunityModule {}