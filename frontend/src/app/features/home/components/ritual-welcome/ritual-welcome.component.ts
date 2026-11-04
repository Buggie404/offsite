import { Component, Input, inject, signal, afterNextRender, DestroyRef } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

export interface HomeRitualProfile {
  archetype: { id: string; name: string; tagline: string } | null;
  radar: Record<string, number>;
}

@Component({
  selector: 'app-ritual-welcome', standalone: true, imports: [RouterLink],
  templateUrl: './ritual-welcome.component.html', styleUrl: './ritual-welcome.component.scss'
})
export class RitualWelcomeComponent {
  @Input() loading = false;
  @Input() profile: HomeRitualProfile | null = null;
  private auth = inject(AuthService);
  private prompt = inject(AuthPromptModalService);
  private router = inject(Router);
  readonly greeting = signal('Hello');
  private destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const updateGreeting = () => {
        const hour = new Date().getHours();
        this.greeting.set(hour >= 5 && hour < 12 ? 'Good morning'
          : hour >= 12 && hour < 17 ? 'Good afternoon'
          : hour >= 17 && hour < 22 ? 'Good evening' : 'Good night');
      };
      updateGreeting();
      const timer = window.setInterval(updateGreeting, 60_000);
      this.destroyRef.onDestroy(() => window.clearInterval(timer));
    });
  }

  readonly axes = ['brightness', 'boldness', 'sweetness', 'skill', 'tempo'];
  get userName(): string {
    const user = this.auth.currentUser();
    const name = user?.profile_name?.trim() || user?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : 'there';
  }
  get points(): string {
    const preview = [76, 48, 68, 54, 80];
    return this.axes.map((axis, i) => {
      const score = this.profile ? this.profile.radar[axis] ?? 0 : preview[i];
      const angle = (-90 + i * 72) * Math.PI / 180;
      const radius = 92 * Math.max(0, Math.min(100, score)) / 100;
      return `${150 + Math.cos(angle) * radius},${150 + Math.sin(angle) * radius}`;
    }).join(' ');
  }
  openQuiz(): void {
    if (!this.auth.isAuthenticated()) { this.prompt.open(); return; }
    void this.router.navigate(['/ritual-dna']);
  }
}
