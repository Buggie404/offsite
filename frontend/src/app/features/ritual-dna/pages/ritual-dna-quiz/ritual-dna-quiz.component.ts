import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LucideArrowLeft,
  LucideArrowRight,
  LucideDownload,
  LucideRotateCcw,
  LucideShare2,
  LucideSparkles,
  LucideAsterisk,
  LucideSparkle
} from '@lucide/angular';
import { HttpService } from '../../../../core/http.service';
import { RitualFitService } from '../../../../shared/components/ritual-fit/ritual-fit.service';
import { toBlob } from 'html-to-image';
import { CreatePostModalComponent } from '../../../community/components/create-post-modal/create-post-modal.component';
import { RitualQuizInviteService } from '../../../community/services/ritual-quiz-invite.service';

type Axis = 'brightness' | 'boldness' | 'sweetness' | 'skill' | 'tempo';
type Radar = Record<Axis, number>;

interface RitualOption {
  option_id: string;
  text: string;
  hint: string;
  icon: string;
}

interface RitualQuestion {
  question_id: string;
  code: string;
  question: string;
  selection_limit: number;
  options: RitualOption[];
}

interface RitualResult {
  is_estimated?: boolean;
  quiz_taken_at?: string | null;
  radar: Radar;
  archetype: { id: string; name: string; tagline: string; description: string; profile_version?: number };
  drink_lean: number;
  lean_confirmed: boolean;
  equipment_level: string | null;
  flavor_tags: string[];
  intensity_preference: string | null;
  servings: string[];
  occasions: string[];
  updated_at: string;
}

@Component({
  selector: 'app-ritual-dna-quiz',
  standalone: true,
  imports: [LucideAsterisk, LucideSparkle,CommonModule, LucideArrowLeft, LucideArrowRight, LucideDownload,
    LucideRotateCcw, LucideShare2, LucideSparkles, CreatePostModalComponent],
  templateUrl: './ritual-dna-quiz.component.html',
  styleUrl: './ritual-dna-quiz.component.scss'
})
export class RitualDnaQuizComponent implements OnInit {
  @ViewChild('quizQuestionStart') private quizQuestionStart?: ElementRef<HTMLElement>;
  @ViewChild('exportCardHost') private exportCardHost?: ElementRef<HTMLElement>;
  private readonly http = inject(HttpService);
  private readonly ritualFits = inject(RitualFitService);
  private readonly ritualInvite = inject(RitualQuizInviteService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  questions: RitualQuestion[] = [];
  shareCardFile: File | null = null;
  sharing = false;
  quizVersion = '';
  confirmationMode = false;
  result: RitualResult | null = null;
  loading = true;
  saving = false;
  errorMessage = '';
  completed = false;
  currentIndex = 0;
  furthestAnsweredIndex = -1;
  reviewingAnswers = false;
  resultNotice = '';
  exporting = false;
  private readonly answers = new Map<string, string[]>();

  async ngOnInit(): Promise<void> {
    const retakeRequested = this.route.snapshot.queryParamMap.get('retake') === '1';
    try {
      const profile = await this.http.get('/ritual-dna/me') as { result: RitualResult | null };
      this.confirmationMode = !!profile.result?.is_estimated && this.route.snapshot.queryParamMap.get('full') !== '1';
      const quiz = await this.http.get('/ritual-dna/questions' + (this.confirmationMode ? '?mode=confirmation' : '')) as { quiz_version: string; questions: RitualQuestion[] };
      this.questions = quiz.questions;
      this.quizVersion = quiz.quiz_version;
      this.result = profile.result;
      this.completed = Boolean(profile.result?.quiz_taken_at) && !retakeRequested;
    } catch (error: any) {
      this.errorMessage = error?.error || error?.message || 'Could not load Ritual DNA. Please try again.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
      if (retakeRequested && this.questions.length) this.scrollToQuestion();
    }
  }

  get question(): RitualQuestion | null { return this.questions[this.currentIndex] || null; }
  get progress(): number { return this.questions.length ? (this.currentIndex + 1) * 100 / this.questions.length : 0; }
  get selectedOptionIds(): string[] { return this.question ? this.answers.get(this.question.question_id) || [] : []; }
  get showNextButton(): boolean { return this.reviewingAnswers && this.selectedOptionIds.length > 0; }
  get showContinueButton(): boolean {
    return !this.reviewingAnswers && !!this.question && this.question.selection_limit > 1 && this.selectedOptionIds.length === 1;
  }
  get radarPoints(): string {
    if (!this.result) return '';
    const values = [this.result.radar.brightness, this.result.radar.boldness,
      this.result.radar.sweetness, this.result.radar.skill, this.result.radar.tempo];
    return values.map((value, index) => {
      const angle = (-90 + index * 72) * Math.PI / 180;
      const distance = 76 * value / 100;
      return `${(100 + Math.cos(angle) * distance).toFixed(1)},${(100 + Math.sin(angle) * distance).toFixed(1)}`;
    }).join(' ');
  }

  isSelected(optionId: string): boolean { return this.selectedOptionIds.includes(optionId); }
  optionSymbol(index: number): string { return String(index + 1).padStart(2, '0'); }

  selectAnswer(optionId: string): void {
    if (!this.question || this.saving) return;
    const selected = this.selectedOptionIds;
    const limit = this.question.selection_limit;
    const next = limit === 1 ? [optionId] : selected.includes(optionId)
      ? selected.filter(id => id !== optionId) : [...selected, optionId].slice(0, limit);
    this.answers.set(this.question.question_id, next);
    this.furthestAnsweredIndex = Math.max(this.furthestAnsweredIndex, this.currentIndex);
    this.errorMessage = '';
    if (!this.reviewingAnswers && next.length === limit) void this.advance();
  }

  previous(): void {
    if (this.currentIndex <= 0 || this.saving) return;
    this.currentIndex--;
    this.reviewingAnswers = true;
    this.errorMessage = '';
  }

  async continueQuiz(): Promise<void> {
    if (!this.selectedOptionIds.length || this.saving) return;
    await this.advance();
  }

  private async advance(): Promise<void> {
    if (this.currentIndex < this.questions.length - 1) {
      this.currentIndex++;
      this.reviewingAnswers = this.currentIndex <= this.furthestAnsweredIndex;
      return;
    }
    await this.submit();
  }

  private scrollToQuestion(): void {
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() => {
      const questionStart = this.quizQuestionStart?.nativeElement;
      if (!questionStart) return;

      const headerHeight = document.querySelector('app-navbar')?.getBoundingClientRect().height ?? 0;
      const questionTop = window.scrollY + questionStart.getBoundingClientRect().top;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({
        top: Math.max(0, questionTop - headerHeight - 8),
        behavior: reducedMotion ? 'auto' : 'smooth'
      });
    });
  }

  private async submit(): Promise<void> {
    const answers = this.questions.map(question => ({
      question_id: question.question_id,
      option_ids: this.answers.get(question.question_id) || []
    }));
    if (answers.some(answer => !answer.option_ids.length)) {
      this.errorMessage = 'Please answer every question before saving.';
      return;
    }
    this.saving = true;
    try {
      const response = await this.http.post('/ritual-dna/quiz', {
        quiz_version: this.quizVersion, mode: this.confirmationMode ? 'confirmation' : 'full', answers
      }) as { result: RitualResult };
      this.result = response.result;
      this.ritualInvite.quizCompleted();
      this.ritualFits.refresh();
      this.completed = true;
      this.reviewingAnswers = false;
      this.resultNotice = 'Your Ritual DNA has been saved to your account.';
      requestAnimationFrame(() => {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    } catch (error: any) {
      this.errorMessage = error?.error || error?.message || 'Could not save your Ritual DNA. Please try again.';
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  async restart(): Promise<void> {
    if (this.confirmationMode) {
      this.loading = true;
      try {
        const quiz = await this.http.get('/ritual-dna/questions') as { quiz_version: string; questions: RitualQuestion[] };
        this.questions = quiz.questions;
        this.quizVersion = quiz.quiz_version;
        this.confirmationMode = false;
      } catch { this.errorMessage = 'Could not load the full quiz. Please try again.'; return; }
      finally { this.loading = false; this.cdr.markForCheck(); }
    }
    this.answers.clear();
    this.currentIndex = 0;
    this.furthestAnsweredIndex = -1;
    this.reviewingAnswers = false;
    this.completed = false;
    this.errorMessage = '';
    this.resultNotice = '';
    this.scrollToQuestion();
  }

  exit(): void { void this.router.navigate(['/']); }

  private async captureCard(): Promise<Blob> {
    const card = this.exportCardHost?.nativeElement.querySelector<HTMLElement>('.dna-card');
    if (!card) throw new Error('Card unavailable');
      await document.fonts.ready;
      await Promise.all(Array.from(card.querySelectorAll('img'), image => image.decode().catch(() => undefined)));
      // SVG paint properties can be absent from html-to-image's HTML-derived
      // style list. Preserve their resolved values as SVG attributes as well.
      const paintProperties = ['fill', 'fill-opacity', 'stroke', 'stroke-width',
        'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray'];
      const svgPaint = Array.from(card.querySelectorAll<SVGElement>('svg *')).map(element => {
        const computed = getComputedStyle(element);
        return {
          element,
          attributes: paintProperties.map(name => ({
            name, original: element.getAttribute(name), value: computed.getPropertyValue(name)
          }))
        };
      });
      let png: Blob | null;
      try {
        for (const { element, attributes } of svgPaint) {
          for (const { name, value } of attributes) {
            if (value) element.setAttribute(name, value);
          }
        }
        png = await toBlob(card, { pixelRatio: 2, cacheBust: true });
      } finally {
        for (const { element, attributes } of svgPaint) {
          for (const { name, original } of attributes) {
            if (original === null) element.removeAttribute(name);
            else element.setAttribute(name, original);
          }
        }
      }
      if (!png) throw new Error('Could not capture the card.');
      return png;
  }

  async shareToCommunity(): Promise<void> {
    if (this.sharing || !this.result) return;
    this.sharing = true;
    this.resultNotice = '';
    try {
      const png = await this.captureCard();
      this.shareCardFile = new File([png], `offsite-ritual-dna-${this.result.archetype.id.toLowerCase()}.png`, { type: 'image/png' });
    } catch {
      this.resultNotice = 'Could not prepare your card. Please try again.';
    } finally {
      this.sharing = false;
      this.cdr.markForCheck();
    }
  }

  async exportCard(): Promise<void> {
    if (!this.result || this.exporting) return;
    this.exporting = true;
    this.resultNotice = '';
    try {
      const png = await this.captureCard();
      const url = URL.createObjectURL(png);
      const link = document.createElement('a');
      link.href = url;
      link.download = `offsite-ritual-dna-${this.result.archetype.id.toLowerCase()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.resultNotice = 'Your Ritual DNA card was downloaded as a PNG.';
    } catch {
      this.resultNotice = 'Could not export your card. Please try again.';
    } finally {
      this.exporting = false;
      this.cdr.markForCheck();
    }
  }

  closeShare(): void { this.shareCardFile = null; }
}
