import { LucideArrowDown, LucideArrowUp, LucideAsterisk, LucideSparkle, LucideTriangleAlert, LucideX } from '@lucide/angular';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  AdminArchetypeRelease, AdminRitualArchetype, AdminRitualDnaService, AdminRitualOverview, AdminSignatureImpact,
  AdminRitualOption, AdminRitualQuestion, AdminQuizRelease, AdminQuizSimulation, DnaAxis, DnaRadar
} from '../../services/admin-ritual-dna.service';
import { RitualDnaCustomersComponent } from '../customers/ritual-dna-customers.component';
import { ToastService } from '../../../../shared/services/toast.service';

@Component({
  selector: 'app-admin-ritual-dna-overview',
  standalone: true,
  imports: [LucideArrowDown, LucideArrowUp, LucideAsterisk, LucideSparkle, LucideTriangleAlert, LucideX,NgTemplateOutlet, RitualDnaCustomersComponent],
  templateUrl: './ritual-dna-overview.component.html',
  styleUrl: './ritual-dna-overview.component.scss'
})
export class RitualDnaOverviewComponent implements OnInit {
  private readonly api = inject(AdminRitualDnaService);
  private readonly toast = inject(ToastService);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly overview = signal<AdminRitualOverview | null>(null);
  readonly tab = signal<'archetypes' | 'quiz' | 'evolution' | 'customers'>('archetypes');
  readonly exampleEvent = signal('order');
  readonly exampleBaseline = signal(40);
  readonly exampleTarget = signal(80);
  readonly selectedArchetypeId = signal<string | null>(null);
  readonly archetypeModalOpen = signal(false);
  readonly archetypeDraft = signal<AdminRitualArchetype[] | null>(null);
  readonly signatureImpact = signal<AdminSignatureImpact | null>(null);
  readonly impactLoading = signal(false);
  readonly impactError = signal('');
  private impactTimer: ReturnType<typeof setTimeout> | null = null;
  private impactRequestId = 0;
  readonly selectedReleaseVersion = signal<number | null>(null);
  readonly releaseBusy = signal(false);
  readonly testRadar = signal<DnaRadar>({ brightness: 50, boldness: 50, sweetness: 50, skill: 50, tempo: 50 });
  readonly selectedQuestionId = signal<string | null>(null);
  readonly quizDraft = signal<AdminRitualQuestion[] | null>(null);
  readonly quizView = signal<'edit' | 'preview'>('edit');
  readonly selectedQuizVersion = signal<number | null>(null);
  readonly quizBusy = signal(false);
  readonly quizTestAnswers = signal<Record<string, string[]>>({});
  readonly quizSimulation = signal<AdminQuizSimulation | null>(null);
  readonly axes: { key: DnaAxis; label: string; short: string }[] = [
    { key: 'brightness', label: 'Brightness', short: 'BRI' },
    { key: 'boldness', label: 'Boldness', short: 'BOL' },
    { key: 'sweetness', label: 'Sweetness', short: 'SWE' },
    { key: 'skill', label: 'Skill', short: 'SKI' },
    { key: 'tempo', label: 'Tempo', short: 'TEM' }
  ];

  ngOnInit(): void { this.load(); }

  load(preferredVersion?: number, preferredQuizVersion?: number): void {
    this.loading.set(true);
    this.error.set('');
    this.api.overview().subscribe({
      next: response => {
        const data = response.data;
        const archetypeReleases = [...data.archetype_releases].sort((a, b) => a.version - b.version);
        const quizReleases = [...data.quiz_releases].sort((a, b) => a.version - b.version);
        this.overview.set({ ...data, archetype_releases: archetypeReleases, quiz_releases: quizReleases });
        this.selectedReleaseVersion.set(archetypeReleases.find(row => row.version === preferredVersion)?.version
          || archetypeReleases[0]?.version || null);
        this.selectedArchetypeId.set(data.archetypes.find(row => row.is_active)?.archetype_id || data.archetypes[0]?.archetype_id || null);
        const quizVersion = quizReleases.find(row => row.version === preferredQuizVersion)?.version || quizReleases[0]?.version || null;
        this.selectedQuizVersion.set(quizVersion);
        this.selectedQuestionId.set(quizReleases.find(row => row.version === quizVersion)?.questions[0]?.question_id || null);
        this.quizSimulation.set(null);
        this.loading.set(false);
      },
      error: error => {
        this.error.set(error?.error?.error || 'Could not load Ritual DNA configuration.');
        this.loading.set(false);
      }
    });
  }

  get selectedArchetype(): AdminRitualArchetype | null {
    return this.archetypes.find(row => row.archetype_id === this.selectedArchetypeId()) || null;
  }

  get archetypes(): AdminRitualArchetype[] {
    return this.archetypeDraft() || this.selectedRelease?.archetypes || this.overview()?.archetypes || [];
  }

  get selectedRelease(): AdminArchetypeRelease | null {
    return this.overview()?.archetype_releases.find(row => row.version === this.selectedReleaseVersion()) || null;
  }

  selectRelease(version: number): void {
    if (this.archetypeDraft()) return;
    this.selectedReleaseVersion.set(version);
    this.selectedArchetypeId.set(this.selectedRelease?.archetypes[0]?.archetype_id || null);
  }

  openArchetypeModal(archetypeId: string): void {
    if (this.selectedRelease?.status !== 'draft') return;
    this.selectedArchetypeId.set(archetypeId);
    this.beginArchetypeEdit();
    this.archetypeModalOpen.set(true);
    this.scheduleSignatureImpact(0);
  }

  closeArchetypeModal(): void {
    if (this.releaseBusy()) return;
    if (this.impactTimer) clearTimeout(this.impactTimer);
    this.impactTimer = null;
    this.impactRequestId++;
    this.signatureImpact.set(null);
    this.archetypeModalOpen.set(false);
    this.discardArchetypeEdit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.archetypeModalOpen()) this.closeArchetypeModal();
  }

  private releaseAction(request: import('rxjs').Observable<unknown>, success: string): void {
    this.releaseBusy.set(true);
    request.subscribe({ next: response => {
      const version = (response as { data?: { version?: number } })?.data?.version || this.selectedReleaseVersion() || undefined;
      this.archetypeModalOpen.set(false);
      this.archetypeDraft.set(null);
      this.releaseBusy.set(false);
      this.load(version);
      this.toast.success(success);
    },
      error: err => { this.releaseBusy.set(false); this.toast.error(err?.error?.error || 'Release action failed.'); } });
  }

  createDraft(sourceVersion?: number): void { this.releaseAction(this.api.createArchetypeDraft(sourceVersion), 'Draft created.'); }
  saveDraft(): void {
    if (!this.selectedRelease || !this.archetypeDraft() || this.archetypeIssues.length) return;
    this.releaseAction(this.api.saveArchetypeDraft(this.selectedRelease, this.archetypeDraft()!), 'Draft saved.');
  }
  transitionRelease(action: 'test' | 'edit' | 'publish'): void {
    if (!this.selectedRelease) return;
    if (action === 'publish' && !window.confirm(`Publish archetype version ${this.selectedRelease.version} to users?`)) return;
    this.releaseAction(this.api.transitionArchetypeRelease(this.selectedRelease.version, action), `Version ${this.selectedRelease.version}: ${action} complete.`);
  }

  deleteDraft(): void {
    const release = this.selectedRelease;
    if (!release || release.published_at || !['draft', 'archived'].includes(release.status)) return;
    if (!window.confirm(`Delete unpublished version ${release.version} permanently? This cannot be undone.`)) return;
    this.releaseAction(this.api.deleteArchetypeDraft(release.version), `Unpublished version ${release.version} deleted.`);
  }

  releaseDate(value: string | null): string {
    if (!value) return 'Not published';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat('en-GB',
      { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
  }

  setTestRadar(axis: DnaAxis, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(value) && value >= 0 && value <= 100) this.testRadar.update(radar => ({ ...radar, [axis]: value }));
  }

  get testDistances(): { id: string; name: string; distance: number }[] {
    const radar = this.testRadar();
    return this.archetypes.filter(row => row.is_active).map(row => ({ id: row.archetype_id, name: row.name,
      distance: Math.sqrt(this.axes.reduce((sum, axis) => sum + (radar[axis.key] - row.taste_profile[axis.key]) ** 2, 0))
    })).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  }

  get archetypeIssues(): string[] {
    const drafts = this.archetypeDraft();
    if (!drafts) return [];
    const issues: string[] = [];
    const names = drafts.map(row => row.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) issues.push('Archetype names must be unique.');
    for (const row of drafts) {
      if (!row.name.trim()) issues.push(`${row.archetype_id}: name is required.`);
      if (!row.description.trim()) issues.push(`${row.archetype_id}: description is required.`);
      for (const axis of this.axes) {
        const value = row.taste_profile[axis.key];
        if (!Number.isInteger(value) || value < 0 || value > 100) {
          issues.push(`${row.archetype_id}: ${axis.label} must be an integer from 0 to 100.`);
        }
      }
    }
    return issues;
  }

  beginArchetypeEdit(): void {
    const rows = this.selectedRelease?.status === 'draft' ? this.selectedRelease.archetypes : null;
    if (!rows?.length) return;
    this.archetypeDraft.set(rows.map(row => ({ ...row, taste_profile: { ...row.taste_profile } })));
  }

  discardArchetypeEdit(): void {
    this.archetypeDraft.set(null);
  }

  updateArchetypeText(archetypeId: string, field: 'name' | 'tagline' | 'description', event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.changeArchetype(archetypeId, row => ({ ...row, [field]: value }));
  }

  updateArchetypeAxis(archetypeId: string, axis: DnaAxis, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = raw === '' ? NaN : Number(raw);
    this.changeArchetype(archetypeId, row => ({
      ...row,
      taste_profile: { ...row.taste_profile, [axis]: value }
    }));
    this.scheduleSignatureImpact();
  }

  get impactOriginName(): string {
    const id = this.signatureImpact()?.most_common_origin_id;
    return this.overview()?.archetypes.find(row => row.archetype_id === id)?.name || id || '';
  }

  private scheduleSignatureImpact(delay = 450): void {
    if (this.impactTimer) clearTimeout(this.impactTimer);
    this.impactRequestId++;
    this.signatureImpact.set(null);
    this.impactError.set('');
    if (this.archetypeIssues.length) {
      this.impactLoading.set(false);
      return;
    }
    this.impactLoading.set(true);
    this.impactTimer = setTimeout(() => {
      this.impactTimer = null;
      const version = this.selectedReleaseVersion();
      const rows = this.archetypeDraft();
      const archetypeId = this.selectedArchetypeId();
      if (!this.archetypeModalOpen() || !version || !rows || !archetypeId) return;
      const requestId = this.impactRequestId;
      this.api.signatureImpact(version, rows, archetypeId).subscribe({
        next: response => {
          if (requestId !== this.impactRequestId || !this.archetypeModalOpen()) return;
          this.signatureImpact.set(response.data);
          this.impactLoading.set(false);
        },
        error: error => {
          if (requestId !== this.impactRequestId || !this.archetypeModalOpen()) return;
          this.impactError.set(error?.error?.error || 'Could not calculate impact.');
          this.impactLoading.set(false);
        }
      });
    }, delay);
  }

  private changeArchetype(archetypeId: string, change: (row: AdminRitualArchetype) => AdminRitualArchetype): void {
    const rows = this.archetypeDraft();
    if (!rows) return;
    this.archetypeDraft.set(rows.map(row => row.archetype_id === archetypeId ? change(row) : row));
  }

  get selectedQuestion(): AdminRitualQuestion | null {
    return this.quizQuestions.find(row => row.question_id === this.selectedQuestionId()) || null;
  }

  get quizQuestions(): AdminRitualQuestion[] {
    return this.quizDraft() || this.selectedQuizRelease?.questions || [];
  }

  get selectedQuizRelease(): AdminQuizRelease | null {
    return this.overview()?.quiz_releases.find(row => row.version === this.selectedQuizVersion()) || null;
  }

  selectQuizRelease(version: number): void {
    if (this.quizDraft()) return;
    this.selectedQuizVersion.set(version);
    this.selectedQuestionId.set(this.selectedQuizRelease?.questions[0]?.question_id || null);
    this.quizTestAnswers.set({});
    this.quizSimulation.set(null);
  }

  private quizAction(request: import('rxjs').Observable<unknown>, success: string): void {
    this.quizBusy.set(true);
    request.subscribe({
      next: response => {
        const version = (response as { data?: { version?: number } })?.data?.version || this.selectedQuizVersion() || undefined;
        this.quizBusy.set(false);
        this.quizDraft.set(null);
        this.load(this.selectedReleaseVersion() || undefined, version);
        this.toast.success(success);
      },
      error: err => { this.quizBusy.set(false); this.toast.error(err?.error?.error || 'Quiz action failed.'); }
    });
  }

  createQuizDraft(sourceVersion?: number): void {
    this.quizAction(this.api.createQuizDraft(sourceVersion), 'Quiz draft created.');
  }

  saveQuizDraft(): void {
    const release = this.selectedQuizRelease;
    const questions = this.quizDraft();
    if (!release || !questions) return;
    if (this.quizIssues.length) {
      this.toast.error(`Fix ${this.quizIssues.length} quiz issue${this.quizIssues.length === 1 ? '' : 's'} before saving.`);
      document.querySelector('.quiz-field-error, .quiz-validation-summary')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    this.quizAction(this.api.saveQuizDraft(release, questions), 'Quiz draft saved.');
  }

  transitionQuizRelease(action: 'test' | 'edit' | 'publish'): void {
    const release = this.selectedQuizRelease;
    if (!release) return;
    if (action === 'publish' && !window.confirm(`Publish quiz version ${release.version} to customers?`)) return;
    this.quizAction(this.api.transitionQuizRelease(release.version, action), `Quiz version ${release.version}: ${action} complete.`);
  }

  deleteQuizDraft(): void {
    const release = this.selectedQuizRelease;
    if (!release || release.status !== 'draft' || !window.confirm(`Delete unpublished quiz version ${release.version} permanently?`)) return;
    this.quizAction(this.api.deleteQuizDraft(release.version), `Quiz version ${release.version} deleted.`);
  }

  toggleQuizTestAnswer(question: AdminRitualQuestion, optionId: string): void {
    const current = this.quizTestAnswers()[question.question_id] || [];
    const next = current.includes(optionId) ? current.filter(id => id !== optionId)
      : question.selection_limit === 1 ? [optionId] : [...current, optionId].slice(-question.selection_limit);
    this.quizTestAnswers.update(answers => ({ ...answers, [question.question_id]: next }));
    this.quizSimulation.set(null);
  }

  get quizTestComplete(): boolean {
    return this.quizQuestions.every(question => (this.quizTestAnswers()[question.question_id] || []).length > 0);
  }

  simulateQuiz(): void {
    const release = this.selectedQuizRelease;
    if (!release || release.status !== 'testing' || !this.quizTestComplete) return;
    const answers = release.questions.map(question => ({ question_id: question.question_id,
      option_ids: this.quizTestAnswers()[question.question_id] || [] }));
    this.quizBusy.set(true);
    this.api.simulateQuiz(release.version, answers).subscribe({
      next: response => {
        this.quizSimulation.set(response.data);
        this.overview.update(data => data ? { ...data, quiz_releases: data.quiz_releases.map(row =>
          row.version === release.version ? { ...row, tested_at: new Date().toISOString() } : row) } : data);
        this.quizBusy.set(false);
      },
      error: err => { this.quizBusy.set(false); this.toast.error(err?.error?.error || 'Quiz simulation failed.'); }
    });
  }

  get quizIssues(): string[] {
    const questions = this.quizDraft();
    if (!questions) return [];
    const issues: string[] = [];
    if (questions.length !== 7) issues.push('The quiz must contain exactly seven questions.');
    if (new Set(questions.map(row => row.question_id)).size !== questions.length) issues.push('Question IDs must be unique.');
    if (new Set(questions.map(row => row.code)).size !== 7) issues.push('The quiz must contain D1–D7 exactly once.');
    if (questions.some((row, index) => row.order !== index + 1)) issues.push('Question positions must be sequential.');
    for (const question of questions) {
      if (!question.question.trim()) issues.push(`${question.code}: question text is required.`);
      if (question.options.length < 2) issues.push(`${question.code}: at least two answers are required.`);
      if (new Set(question.options.map(row => row.option_id)).size !== question.options.length) issues.push(`${question.code}: answer IDs must be unique.`);
      if (question.selection_limit > question.options.length) issues.push(`${question.code}: selection limit exceeds the answer count.`);
      const expectedLimit = question.code === 'D4' || question.code === 'D7' ? 2 : 1;
      if (question.selection_limit !== expectedLimit) issues.push(`${question.code}: the agreed selection limit is ${expectedLimit}.`);
      for (const option of question.options) {
        if (!option.text.trim()) issues.push(`${question.code} / ${option.option_id}: answer text is required.`);
        if (question.code === 'D1' && (option.drink_lean == null || !Number.isInteger(option.drink_lean) || option.drink_lean < 0 || option.drink_lean > 100)) {
          issues.push(`${question.code} / ${option.option_id}: matcha preference must be an integer from 0 to 100.`);
        }
        if (question.code !== 'D1' && !Object.keys(option.score_weights || {}).length) {
          issues.push(`${question.code} / ${option.option_id}: add at least one axis weight.`);
        }
        if (question.code === 'D3' && !option.equipment_level) issues.push(`${question.code} / ${option.option_id}: equipment level is required.`);
        if (question.code === 'D6' && !option.serving) issues.push(`${question.code} / ${option.option_id}: serving style is required.`);
        if (question.code === 'D7' && !option.occasion) issues.push(`${question.code} / ${option.option_id}: occasion is required.`);
        for (const axis of this.axes) {
          const score = option.score_weights?.[axis.key];
          if (score != null && (!Number.isInteger(score) || score < 0 || score > 5)) {
            issues.push(`${question.code} / ${option.option_id}: ${axis.label} must be an integer from 0 to 5.`);
          }
        }
      }
    }
    return issues;
  }

  quizQuestionIssues(question: AdminRitualQuestion): string[] {
    return this.quizIssues.filter(issue => issue.startsWith(`${question.code}:`));
  }

  quizOptionIssues(question: AdminRitualQuestion, option: AdminRitualOption): string[] {
    return this.quizIssues.filter(issue => issue.startsWith(`${question.code} / ${option.option_id}:`));
  }

  invalidQuizScore(option: AdminRitualOption, axis: DnaAxis): boolean {
    const value = option.score_weights?.[axis];
    return value != null && (!Number.isInteger(value) || value < 0 || value > 5);
  }

  beginQuizEdit(): void {
    const questions = this.selectedQuizRelease?.status === 'draft' ? this.selectedQuizRelease.questions : null;
    if (!questions?.length) return;
    this.quizDraft.set(questions.map(question => ({
      ...question,
      options: question.options.map(option => ({ ...option, score_weights: { ...option.score_weights } }))
    })));
    this.quizView.set('edit');
  }

  discardQuizEdit(): void {
    this.quizDraft.set(null);
    this.quizView.set('edit');
  }

  updateQuestionText(questionId: string, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.changeQuestion(questionId, question => ({ ...question, question: value }));
  }

  updateOptionText(questionId: string, optionId: string, field: 'text' | 'hint', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.changeOption(questionId, optionId, option => ({ ...option, [field]: value }));
  }

  updateOptionScore(questionId: string, optionId: string, axis: DnaAxis, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = raw === '' ? undefined : Number(raw);
    this.changeOption(questionId, optionId, option => {
      const score_weights = { ...option.score_weights };
      if (value === undefined) delete score_weights[axis];
      else score_weights[axis] = value;
      return { ...option, score_weights };
    });
  }

  updateOptionAttribute(questionId: string, optionId: string, field: 'drink_lean' | 'equipment_level' | 'serving' | 'occasion', event: Event): void {
    const raw = (event.target as HTMLInputElement | HTMLSelectElement).value;
    const value = field === 'drink_lean' ? (raw === '' ? null : Number(raw)) : (raw || null);
    this.changeOption(questionId, optionId, option => ({ ...option, [field]: value }));
  }

  moveQuestion(questionId: string, direction: -1 | 1): void {
    const questions = this.quizDraft();
    if (!questions) return;
    const index = questions.findIndex(row => row.question_id === questionId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    this.quizDraft.set(reordered.map((row, position) => ({ ...row, order: position + 1 })));
  }

  moveOption(questionId: string, optionId: string, direction: -1 | 1): void {
    this.changeQuestion(questionId, question => {
      const index = question.options.findIndex(row => row.option_id === optionId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= question.options.length) return question;
      const options = [...question.options];
      [options[index], options[next]] = [options[next], options[index]];
      return { ...question, options };
    });
  }

  private changeOption(questionId: string, optionId: string, change: (option: AdminRitualOption) => AdminRitualOption): void {
    this.changeQuestion(questionId, question => ({
      ...question,
      options: question.options.map(option => option.option_id === optionId ? change(option) : option)
    }));
  }

  private changeQuestion(questionId: string, change: (question: AdminRitualQuestion) => AdminRitualQuestion): void {
    const questions = this.quizDraft();
    if (!questions) return;
    this.quizDraft.set(questions.map(question => question.question_id === questionId ? change(question) : question));
  }

  get completionPercent(): number {
    const summary = this.overview()?.summary;
    return summary?.total_customers ? Math.round(summary.profiles / summary.total_customers * 100) : 0;
  }

  setExampleScore(field: 'baseline' | 'target', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const score = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    if (field === 'baseline') this.exampleBaseline.set(score);
    else this.exampleTarget.set(score);
  }

  get exampleWeight(): number {
    return this.overview()?.behavior_rules.events.find(row => row.key === this.exampleEvent())?.weight || 0;
  }

  get exampleShare(): number {
    const rules = this.overview()?.behavior_rules;
    return rules ? rules.max_behavior_share * Math.min(this.exampleWeight / rules.evidence_target, 1) : 0;
  }

  get exampleResult(): number {
    return Math.round(this.exampleBaseline() * (1 - this.exampleShare) + this.exampleTarget() * this.exampleShare);
  }

  radarPoints(radar: DnaRadar | null | undefined): string {
    if (!radar) return '';
    return this.axes.map(({ key }, index) => {
      const angle = (-90 + index * 72) * Math.PI / 180;
      const value = Number.isFinite(radar[key]) ? radar[key] : 0;
      const radius = 76 * Math.max(0, Math.min(100, value)) / 100;
      return `${(100 + Math.cos(angle) * radius).toFixed(1)},${(100 + Math.sin(angle) * radius).toFixed(1)}`;
    }).join(' ');
  }

  score(option: AdminRitualOption, axis: DnaAxis): number | string {
    return option.score_weights?.[axis] ?? '—';
  }
}
