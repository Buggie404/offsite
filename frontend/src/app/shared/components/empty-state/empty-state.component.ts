import {
  LucideBookOpen, LucideBookmark, LucideCoffee, LucideCreditCard, LucideHash, LucideHeart, LucideHouse, LucideLeaf,
  LucideListFilter, LucideMail, LucideMapPin, LucideMessageCircle, LucideRepeat, LucideSearch, LucideSparkles,
  LucideSpellCheck, LucideStar, LucideTruck, LucideUser,
} from '@lucide/angular';
import { Component, Input } from '@angular/core';

export type EmptyStateIcon =
  | 'search' | 'filter' | 'spell' | 'sparkles' | 'hash' | 'mail' | 'user' | 'message' | 'heart' | 'bookmark'
  | 'map-pin' | 'home' | 'star' | 'truck' | 'card' | 'repeat' | 'book' | 'coffee' | 'leaf';

export interface EmptyStateChip {
  icon: EmptyStateIcon;
  label: string;
}

let nextId = 0;

/**
 * Shared empty state — the Ritual Box look: a soft glow behind a centred message,
 * with small hint chips orbiting it. Project buttons / links as content to add CTAs;
 * give them `es-btn` (and `es-btn--primary` for the main one).
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [
    LucideBookOpen, LucideBookmark, LucideCoffee, LucideCreditCard, LucideHash, LucideHeart, LucideHouse, LucideLeaf,
    LucideListFilter, LucideMail, LucideMapPin, LucideMessageCircle, LucideRepeat, LucideSearch, LucideSparkles,
    LucideSpellCheck, LucideStar, LucideTruck, LucideUser,
  ],
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  @Input() eyebrow = '';
  @Input({ required: true }) title = '';
  @Input() text = '';
  @Input() hint = '';
  /** Up to six short hints placed around the glow. */
  @Input() chips: EmptyStateChip[] = [];
  /** Tighter variant for narrow panels (account tabs, cards). */
  @Input() compact = false;

  readonly titleId = `empty-state-title-${nextId++}`;

  /** Orbit slot (1–6) for a chip, spread so any count stays balanced around the message. */
  slot(index: number): number {
    const layouts: Record<number, number[]> = { 1: [2], 2: [1, 6], 3: [1, 2, 5], 4: [1, 2, 5, 6], 5: [1, 2, 3, 5, 6] };
    return (layouts[this.chips.length] ?? [1, 2, 3, 4, 5, 6])[index] ?? index + 1;
  }
}
