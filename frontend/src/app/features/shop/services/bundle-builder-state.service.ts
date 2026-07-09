import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { BundleBuilderSnapshot } from '../pages/build-your-bundle/build-your-bundle.types';

@Injectable({
  providedIn: 'root'
})
export class BundleBuilderStateService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'offsite_bundle_builder_state';
  private memorySnapshot: BundleBuilderSnapshot | null = null;

  getSnapshot(): BundleBuilderSnapshot | null {
    if (this.memorySnapshot) {
      return this.memorySnapshot;
    }

    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) return null;
      this.memorySnapshot = JSON.parse(raw) as BundleBuilderSnapshot;
      return this.memorySnapshot;
    } catch {
      return null;
    }
  }

  saveSnapshot(snapshot: BundleBuilderSnapshot): void {
    this.memorySnapshot = snapshot;

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    sessionStorage.setItem(this.storageKey, JSON.stringify(snapshot));
  }

  clearSnapshot(): void {
    this.memorySnapshot = null;

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    sessionStorage.removeItem(this.storageKey);
  }
}
