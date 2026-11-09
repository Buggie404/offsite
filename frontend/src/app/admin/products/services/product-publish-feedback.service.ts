import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ProductPublishFeedbackService {
  private pending = false;

  published(): void { this.pending = true; }

  consume(): boolean {
    const pending = this.pending;
    this.pending = false;
    return pending;
  }
}
