import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type DnaAxis = 'brightness' | 'boldness' | 'sweetness' | 'skill' | 'tempo';
export type DnaRadar = Record<DnaAxis, number>;

export interface AdminRitualOption {
  option_id: string;
  code: string;
  text: string;
  hint: string;
  score_weights: Partial<DnaRadar>;
  drink_lean?: number | null;
  lean_confirmed?: boolean | null;
  equipment_level?: string | null;
  serving?: string | null;
  occasion?: string | null;
}

export interface AdminRitualQuestion {
  question_id: string;
  code: string;
  question: string;
  order: number;
  selection_limit: number;
  quiz_version: string;
  is_active: boolean;
  options: AdminRitualOption[];
}

export interface AdminRitualArchetype {
  archetype_id: string;
  name: string;
  tagline: string;
  description: string;
  badge_icon: string;
  taste_profile: DnaRadar;
  profile_version: number;
  is_active: boolean;
  member_count: number;
}

export interface AdminRitualOverview {
  archetype_releases: AdminArchetypeRelease[];
  quiz_releases: AdminQuizRelease[];
  summary: { total_customers: number; profiles: number; active_question_count: number; active_archetype_count: number };
  versions: { version: string; question_count: number; active_question_count: number; member_count: number }[];
  active_quiz: { version: string | null; questions: AdminRitualQuestion[] };
  archetypes: AdminRitualArchetype[];
  behavior_rules: {
    version: string;
    evidence_target: number;
    max_behavior_share: number;
    archetype_margin: number;
    archetype_cooldown_days: number;
    save_daily_cap: number;
    events: { key: string; label: string; weight: number; daily_cap: number | null }[];
  };
}

export interface AdminQuizRelease {
  version: number;
  status: 'draft' | 'testing' | 'active' | 'archived';
  source_version: number | null;
  updated_at: string;
  published_at: string | null;
  tested_at: string | null;
  created_by: string | null;
  member_count: number;
  questions: AdminRitualQuestion[];
}

export interface AdminQuizSimulation {
  radar: DnaRadar;
  archetype: { id: string; name: string };
  attributes: Record<string, unknown>;
}

export interface AdminArchetypeRelease {
  version: number;
  status: 'draft' | 'testing' | 'active' | 'archived';
  source_version: number | null;
  updated_at: string;
  published_at: string | null;
  created_by: string | null;
  archetypes: AdminRitualArchetype[];
}

export interface AdminSignatureImpact {
  total_profiles: number;
  changed_nearest: number;
  toward_selected: number;
  most_common_origin_id: string | null;
  most_common_origin_count: number;
  archetype_id: string;
  source_version: number;
}

export interface AdminDnaCustomer {
  user_id: string;
  name: string;
  email: string | null;
  archetype_id: string | null;
  quiz_taken_at: string | null;
  updated_at: string | null;
}

export interface AdminDnaHistoryEntry {
  event_id: string;
  at: string;
  source: string;
  source_id: string | null;
  rule_version: string;
  weight: number | null;
  delta: Partial<DnaRadar>;
  radar_before: DnaRadar | null;
  radar_after: DnaRadar;
  target_profile_before: Partial<DnaRadar> | null;
  target_profile_after: Partial<DnaRadar> | null;
  archetype_before: string | null;
  archetype_id: string;
}

export interface AdminDnaCustomerDetail {
  user_id: string;
  name: string;
  email: string | null;
  dna: {
    archetype_id: string;
    archetype_name: string;
    archetype_tagline: string;
    radar: DnaRadar;
    baseline: DnaRadar;
    quiz_version: string | null;
    quiz_taken_at: string;
    updated_at: string;
    last_archetype_change_at: string | null;
  } | null;
  history: AdminDnaHistoryEntry[];
  history_total: number;
  page: number;
  limit: number;
}

@Injectable({ providedIn: 'root' })
export class AdminRitualDnaService {
  private readonly http = inject(HttpClient);

  overview(): Observable<{ data: AdminRitualOverview }> {
    return this.http.get<{ data: AdminRitualOverview }>('/api/admin/ritual-dna/overview');
  }

  createQuizDraft(sourceVersion?: number): Observable<{ data: AdminQuizRelease }> {
    return this.http.post<{ data: AdminQuizRelease }>('/api/admin/ritual-dna/quiz-releases',
      sourceVersion == null ? {} : { source_version: sourceVersion });
  }

  saveQuizDraft(release: AdminQuizRelease, questions: AdminRitualQuestion[]): Observable<{ data: AdminQuizRelease }> {
    return this.http.put<{ data: AdminQuizRelease }>(`/api/admin/ritual-dna/quiz-releases/${release.version}`,
      { updated_at: release.updated_at, questions });
  }

  transitionQuizRelease(version: number, action: 'test' | 'edit' | 'publish'): Observable<unknown> {
    return this.http.post(`/api/admin/ritual-dna/quiz-releases/${version}/${action}`, {});
  }

  deleteQuizDraft(version: number): Observable<unknown> {
    return this.http.delete(`/api/admin/ritual-dna/quiz-releases/${version}`);
  }

  simulateQuiz(version: number, answers: { question_id: string; option_ids: string[] }[]): Observable<{ data: AdminQuizSimulation }> {
    return this.http.post<{ data: AdminQuizSimulation }>(`/api/admin/ritual-dna/quiz-releases/${version}/simulate`, { answers });
  }

  createArchetypeDraft(sourceVersion?: number): Observable<{ data: AdminArchetypeRelease }> {
    return this.http.post<{ data: AdminArchetypeRelease }>('/api/admin/ritual-dna/archetype-releases',
      sourceVersion == null ? {} : { source_version: sourceVersion });
  }

  saveArchetypeDraft(release: AdminArchetypeRelease, archetypes: AdminRitualArchetype[]): Observable<{ data: AdminArchetypeRelease }> {
    return this.http.put<{ data: AdminArchetypeRelease }>(`/api/admin/ritual-dna/archetype-releases/${release.version}`,
      { updated_at: release.updated_at, archetypes });
  }

  signatureImpact(version: number, archetypes: AdminRitualArchetype[], archetypeId: string): Observable<{ data: AdminSignatureImpact }> {
    return this.http.post<{ data: AdminSignatureImpact }>(`/api/admin/ritual-dna/archetype-releases/${version}/impact`,
      { archetypes, archetype_id: archetypeId });
  }

  transitionArchetypeRelease(version: number, action: 'test' | 'edit' | 'publish'): Observable<unknown> {
    return this.http.post(`/api/admin/ritual-dna/archetype-releases/${version}/${action}`, {});
  }

  deleteArchetypeDraft(version: number): Observable<unknown> {
    return this.http.delete(`/api/admin/ritual-dna/archetype-releases/${version}`);
  }

  customers(params: { page: number; search: string; status: string; archetype: string }): Observable<{
    data: AdminDnaCustomer[]; total: number; page: number; limit: number
  }> {
    return this.http.get<{ data: AdminDnaCustomer[]; total: number; page: number; limit: number }>(
      '/api/admin/ritual-dna/customers', { params }
    );
  }

  customerDetail(userId: string, page: number): Observable<{ data: AdminDnaCustomerDetail }> {
    return this.http.get<{ data: AdminDnaCustomerDetail }>(
      `/api/admin/ritual-dna/customers/${encodeURIComponent(userId)}`, { params: { page } }
    );
  }
}
