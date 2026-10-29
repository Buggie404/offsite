import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import type { QuizQuestion, QuizResult } from './starter-quiz.types';

const SESSION_KEY = 'offsite_starter_quiz_session';

@Injectable({
  providedIn: 'root'
})
export class StarterQuizService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = `${environment.apiUrl}/starter-quiz`;

  getQuestions(): Observable<{ questions: QuizQuestion[] }> {
    return this.http.get<{ questions: QuizQuestion[] }>(`${this.api}/questions`);
  }

  submit(
    answers: { question_id: string; option_id: string }[],
    sessionId: string | null
  ): Observable<{ result: QuizResult }> {
    return this.http.post<{ result: QuizResult }>(`${this.api}/results`, {
      answers,
      session_id: sessionId
    });
  }

  sessionId(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = `QS${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    localStorage.setItem(SESSION_KEY, created);
    return created;
  }

  claimGuestResult(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) return;
    this.http.post<{ claimed: boolean }>(`${this.api}/results/claim`, { session_id: sessionId }).subscribe({
      next: (response) => {
        if (response?.claimed) localStorage.removeItem(SESSION_KEY);
      },
      error: () => undefined
    });
  }
}
