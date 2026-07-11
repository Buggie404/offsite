import { Injectable, NgZone, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

type ParallaxTickCallback = () => void;

/**
 * Single shared scroll/resize listener (rAF-batched) that every
 * [appParallax] directive instance subscribes to, instead of each
 * element binding its own window listener.
 */
@Injectable({ providedIn: 'root' })
export class ParallaxScrollService {
  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly callbacks = new Set<ParallaxTickCallback>();
  private frameId: number | null = null;
  private listenersBound = false;

  register(callback: ParallaxTickCallback): () => void {
    if (isPlatformBrowser(this.platformId)) {
      this.bindListeners();
      callback();
    }
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private bindListeners(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    this.ngZone.runOutsideAngular(() => {
      const requestTick = () => {
        if (this.frameId !== null) return;
        this.frameId = requestAnimationFrame(() => {
          this.frameId = null;
          this.callbacks.forEach((callback) => callback());
        });
      };

      window.addEventListener('scroll', requestTick, { passive: true });
      window.addEventListener('resize', requestTick, { passive: true });
    });
  }
}
