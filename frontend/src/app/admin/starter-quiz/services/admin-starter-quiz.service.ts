import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type MatchingRole = 'copy_only' | 'primary' | 'secondary' | 'hard_filter';
export type KitDrink = 'matcha' | 'coffee' | 'mixed' | 'any';
export type KitLevel = 'beginner' | 'ritual' | 'craft' | 'any';
export type KitBudget = 'under_60' | 'mid_60_120' | 'over_120';
export type KitStatus = 'active' | 'suspended' | 'draft';
export type SlotCategory = 'matcha' | 'coffee' | 'tools' | 'drinkware';

export interface QuizOption {
  option_id: string;
  text: string;
  hint: string;
  icon: string;
  code: string;
  score_weights?: Record<string, number>;
}

export interface QuizQuestion {
  question_id: string;
  code: string;
  question: string;
  order: number;
  matching_role: MatchingRole;
  is_active: boolean;
  options: QuizOption[];
}

export interface KitSlot {
  slot_id: string;
  name: string;
  category: SlotCategory;
  attribute: string;
  constraint: string;
  hero: boolean;
  match_count?: number;
  stock_count?: number;
  min_price?: number;
  max_price?: number;
}

export interface QuizKit {
  kit_id: string;
  name: string;
  tier: string;
  description: string;
  image_url: string;
  drink: KitDrink;
  level: KitLevel;
  budget: KitBudget;
  budget_label: string;
  discount_percent: number;
  status: KitStatus;
  display_status: KitStatus;
  order: number;
  slots: KitSlot[];
  slot_summary: string;
  stock: { code: 'ok' | 'range_low' | 'hero_oos'; label: string };
  retail: { min: number; max: number };
  bundle: { min: number; max: number };
  price_label: string;
}

export interface KitDraft {
  name: string;
  tier: string;
  description: string;
  image_url: string;
  drink: KitDrink;
  level: KitLevel;
  budget: KitBudget;
  discount_percent: number;
  status: KitStatus;
  slots: KitSlot[];
}

export interface RuleTest {
  drink: string;
  level: string;
  budget: string;
  steps: string[];
  kit: QuizKit | null;
  result: string;
}

export interface QuizConfigResponse {
  enabled: boolean;
  questions: QuizQuestion[];
  kits: QuizKit[];
}

@Injectable({ providedIn: 'root' })
export class AdminStarterQuizService {
  private readonly http = inject(HttpClient);
  private readonly api = '/api/admin/starter-quiz';

  getConfig(): Observable<QuizConfigResponse> {
    return this.http.get<QuizConfigResponse>(this.api);
  }

  updateSettings(enabled: boolean): Observable<{ enabled: boolean }> {
    return this.http.patch<{ enabled: boolean }>(`${this.api}/settings`, { enabled });
  }

  createQuestion(): Observable<{ question: QuizQuestion }> {
    return this.http.post<{ question: QuizQuestion }>(`${this.api}/questions`, {});
  }

  updateQuestion(questionId: string, question: QuizQuestion): Observable<{ question: QuizQuestion }> {
    return this.http.patch<{ question: QuizQuestion }>(`${this.api}/questions/${questionId}`, question);
  }

  deleteQuestion(questionId: string): Observable<{ deleted: string }> {
    return this.http.delete<{ deleted: string }>(`${this.api}/questions/${questionId}`);
  }

  reorderQuestions(questionIds: string[]): Observable<{ question_ids: string[] }> {
    return this.http.put<{ question_ids: string[] }>(`${this.api}/questions/reorder`, { question_ids: questionIds });
  }

  previewKit(draft: KitDraft): Observable<{ kit: QuizKit }> {
    return this.http.post<{ kit: QuizKit }>(`${this.api}/kits/preview`, draft);
  }

  createKit(draft: KitDraft): Observable<{ kit: QuizKit }> {
    return this.http.post<{ kit: QuizKit }>(`${this.api}/kits`, draft);
  }

  updateKit(kitId: string, draft: KitDraft): Observable<{ kit: QuizKit }> {
    return this.http.patch<{ kit: QuizKit }>(`${this.api}/kits/${kitId}`, draft);
  }

  testRules(answers: { drink: string; level: string; budget: string }): Observable<RuleTest> {
    return this.http.post<RuleTest>(`${this.api}/kits/test`, answers);
  }
}
