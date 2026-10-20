import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/feed/feed.component').then(m => m.FeedComponent)
  },
  {
    path: 'profile/:userId',
    loadComponent: () =>
      import('./pages/public-profile/public-profile.component')
        .then(m => m.PublicProfileComponent)
  },
  {
    path: 'post/:id',
    loadComponent: () =>
      import('./pages/post-detail/post-detail.component')
        .then(m => m.PostDetailComponent)
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CommunityRoutingModule {}