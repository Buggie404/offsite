import { Component, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Post } from '../../models/post.model';
import { RitualQuizInviteService } from '../../services/ritual-quiz-invite.service';

@Component({
  selector: 'app-ritual-quiz-invite', standalone: true, imports: [RouterLink],
  template: `@if (post.post_type === 'ritual_dna' && invite.visible()) {
    <a class="ritual-quiz-link" [attr.data-archetype]="post.ritual_preview?.archetype_id" routerLink="/ritual-dna" [queryParams]="{ retake: '1' }" (click)="$event.stopPropagation()">Discover your Ritual DNA <span aria-hidden="true">→</span></a>
  }`,
  styleUrl: './ritual-quiz-invite.component.scss'
})
export class RitualQuizInviteComponent {
  @Input({ required: true }) post!: Post;
  readonly invite = inject(RitualQuizInviteService);
}
