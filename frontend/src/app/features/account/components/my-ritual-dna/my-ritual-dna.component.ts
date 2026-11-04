import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpService } from '../../../../core/http.service';

type Axis = 'brightness' | 'boldness' | 'sweetness' | 'skill' | 'tempo';
type Radar = Record<Axis, number>;

interface RitualHistory {
  at: string;
  source: string;
  delta: Partial<Radar>;
  radar_after: Radar;
  archetype_id: string;
}

interface RitualProfile {
  radar: Radar;
  baseline: Radar;
  archetype: { id: string; name: string; tagline: string; description: string; profile_version?: number } | null;
  drink_lean: number;
  lean_confirmed: boolean;
  equipment_level: string | null;
  flavor_tags: string[];
  intensity_preference: string | null;
  servings: string[];
  occasions: string[];
  quiz_taken_at: string | null;
  updated_at: string;
  history: RitualHistory[];
}

interface RitualPick {
  id: string;
  name: string;
  slug: string;
  image: string;
  reason: string;
  price?: number;
  difficulty?: string;
  minutes?: number;
}

interface RitualRecommendations {
  products: RitualPick[];
  recipes: RitualPick[];
  source: 'ai' | 'rules';
  cached: boolean;
}

@Component({
  selector: 'app-my-ritual-dna',
  standalone: true,
  imports: [DatePipe, RouterLink, TitleCasePipe],
  templateUrl: './my-ritual-dna.component.html',
  styleUrl: './my-ritual-dna.component.scss'
})
export class MyRitualDnaComponent implements OnInit {
  private readonly http = inject(HttpService);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly profile = signal<RitualProfile | null>(null);
  readonly recommendations = signal<RitualRecommendations | null>(null);
  readonly recommendationsLoading = signal(false);
  readonly recommendationsError = signal(false);
  readonly axes: { key: Axis; label: string; description: string }[] = [
    { key: 'brightness', label: 'Brightness', description: 'Fresh, lively flavour' },
    { key: 'boldness', label: 'Boldness', description: 'Strength and intensity' },
    { key: 'sweetness', label: 'Sweetness', description: 'Sweet, creamy comfort' },
    { key: 'skill', label: 'Skill', description: 'Interest in making and tools' },
    { key: 'tempo', label: 'Tempo', description: 'Fast, practical rhythm' }
  ];

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await this.http.get('/ritual-dna/me') as { result: RitualProfile | null };
      this.profile.set(response.result);
      if (response.result) void this.loadRecommendations();
    } catch (error: any) {
      this.error.set(error?.error || error?.message || 'Could not load your Ritual DNA.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadRecommendations(): Promise<void> {
    this.recommendationsLoading.set(true);
    this.recommendationsError.set(false);
    try {
      const response = await this.http.get('/ritual-dna/recommendations') as { data: RitualRecommendations };
      this.recommendations.set(response.data);
    } catch {
      this.recommendationsError.set(true);
    } finally {
      this.recommendationsLoading.set(false);
    }
  }

  radarPoints(radar: Radar | null | undefined): string {
    if (!radar) return '';
    return this.axes.map(({ key }, index) => {
      const angle = (-90 + index * 72) * Math.PI / 180;
      const radius = 78 * Math.max(0, Math.min(100, radar[key])) / 100;
      return `${(100 + Math.cos(angle) * radius).toFixed(1)},${(100 + Math.sin(angle) * radius).toFixed(1)}`;
    }).join(' ');
  }

  hasEvolution(profile: RitualProfile): boolean {
    return this.axes.some(({ key }) => profile.radar[key] !== profile.baseline?.[key]);
  }

  drinkPreference(profile: RitualProfile): string {
    if (!profile.lean_confirmed) return 'Still exploring matcha and coffee';
    if (profile.drink_lean > 55) return 'Leans toward matcha';
    if (profile.drink_lean < 45) return 'Leans toward coffee';
    return 'Enjoys matcha and coffee equally';
  }

  evolutionAxes(profile: RitualProfile): { key: Axis; label: string; change: number; current: number }[] {
    return this.axes.map(axis => ({ key: axis.key, label: axis.label,
      change: profile.radar[axis.key] - (profile.baseline?.[axis.key] ?? profile.radar[axis.key]),
      current: profile.radar[axis.key] }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }

  evolutionPoints(profile: RitualProfile, axis: Axis): string {
    const start = profile.baseline?.[axis] ?? profile.radar[axis];
    const events = [...(profile.history || [])].reverse()
      .filter(event => event.source !== 'quiz' && Number.isFinite(event.radar_after?.[axis]));
    const values = [start, ...events.map(event => event.radar_after[axis])];
    if (values.length === 1) values.push(profile.radar[axis]);
    return values.map((value, index) => {
      const x = 18 + (index / (values.length - 1)) * 564;
      const y = 144 - Math.max(0, Math.min(100, value)) * 1.16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  evolutionMessage(profile: RitualProfile): string {
    const leading = this.evolutionAxes(profile)[0];
    if (!leading?.change) return 'Your quiz set the first notes. Your profile will grow as you save recipes and explore new cups.';
    return `${leading.label} has ${leading.change > 0 ? 'grown' : 'softened'} by ${Math.abs(leading.change)} points since your first quiz.`;
  }

  historyLabel(source: string): string {
    const labels: Record<string, string> = {
      quiz: 'Quiz completed', order: 'Order delivered', order_refund: 'Order refunded', recipe_saved: 'Recipe saved',
      product_saved: 'Product saved', brew: 'Brew completed'
    };
    return labels[source] || 'Ritual updated';
  }

  readableTag(tag: string): string { return tag.replace(/_/g, ' '); }

  changeSummary(event: RitualHistory): string {
    if (event.source === 'quiz') return 'Your starting profile was recorded.';
    const changes = this.axes
      .filter(axis => event.delta?.[axis.key])
      .map(axis => `${axis.label} ${event.delta[axis.key]! > 0 ? '+' : ''}${event.delta[axis.key]}`);
    return changes.length ? changes.join(' · ') : 'Evidence recorded; radar unchanged.';
  }
}
