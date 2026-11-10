import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class RitualDnaBadgeService {
  private http = inject(HttpClient);

  load() {
    return this.http.get<{ result: { quiz_taken_at?: string | null; archetype: { id: string; name: string } | null } | null }>('/api/ritual-dna/me')
      .pipe(map(response => response.result?.quiz_taken_at ? response.result.archetype || null : null));
  }
}
