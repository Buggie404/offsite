import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { CartService } from '../../../purchase/services/cart.service';
import { createKitBundle } from '../../../purchase/models/bundle-cart.model';
import type { Product as CartProduct } from '../../../../shared/models/product.model';
import { BundleBuilderStateService } from '../../services/bundle-builder-state.service';
import type { SlotKey } from '../build-your-bundle/build-your-bundle.types';
import { StarterQuizService } from './starter-quiz.service';
import type { QuizKit, QuizQuestion } from './starter-quiz.types';

type QuizStep = 'intro' | 'question' | 'result';

@Component({
  selector: 'app-starter-quiz',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './starter-quiz.component.html',
  styleUrl: './starter-quiz.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StarterQuizComponent implements OnInit {
  private readonly quizApi = inject(StarterQuizService);
  private readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly bundleState = inject(BundleBuilderStateService);
  private readonly auth = inject(AuthService);
  private readonly authModal = inject(AuthModalService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly step = signal<QuizStep>('intro');
  readonly questions = signal<QuizQuestion[]>([]);
  readonly answers = signal<Record<string, string>>({});
  readonly questionIndex = signal(0);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly adding = signal(false);
  readonly added = signal(false);
  readonly errorMessage = signal('');
  readonly kit = signal<QuizKit | null>(null);

  private awaitingAccountSave = false;

  readonly isAuthenticated = this.auth.isAuthenticated;

  readonly visibleQuestions = computed(() => {
    const chosen = this.answers();
    return this.questions().filter((question) => {
      if (!question.visible_when?.question_id) return true;
      return chosen[question.visible_when.question_id] === question.visible_when.option_id;
    });
  });

  readonly currentQuestion = computed(() => this.visibleQuestions()[this.questionIndex()] ?? null);

  readonly progress = computed(() => {
    const total = this.visibleQuestions().length || 1;
    return Math.min(100, ((this.questionIndex() + 1) / total) * 100);
  });

  readonly globalNotes = computed(() => {
    const kit = this.kit();
    if (!kit) return [];
    const itemNotes = new Set(kit.items.map((item) => item.note).filter((note): note is string => !!note));
    return kit.notes.filter((note) => !itemNotes.has(note));
  });

  constructor() {
    effect(() => {
      if (!this.auth.isAuthenticated() || !this.awaitingAccountSave || !this.kit()) return;
      this.awaitingAccountSave = false;
      this.submitAnswers();
    });
  }

  ngOnInit(): void {
    this.quizApi.getQuestions().subscribe({
      next: (response) => {
        this.questions.set(response.questions || []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('The quiz could not be loaded. Please refresh and try again.');
      }
    });
  }

  start(): void {
    if (!this.questions().length) return;
    this.errorMessage.set('');
    this.added.set(false);
    this.kit.set(null);
    this.awaitingAccountSave = false;
    this.answers.set({});
    this.questionIndex.set(0);
    this.step.set('question');
  }

  selectOption(questionId: string, optionId: string): void {
    this.answers.update((current) => {
      const next = { ...current, [questionId]: optionId };
      if (questionId === 'SQ002' && optionId !== 'B') {
        delete next['SQ003'];
      }
      return next;
    });
  }

  isSelected(questionId: string, optionId: string): boolean {
    return this.answers()[questionId] === optionId;
  }

  canContinue(): boolean {
    const question = this.currentQuestion();
    if (!question) return false;
    return !!this.answers()[question.question_id];
  }

  previous(): void {
    if (this.questionIndex() === 0) {
      this.step.set('intro');
      return;
    }
    this.questionIndex.update((index) => Math.max(0, index - 1));
  }

  next(): void {
    if (!this.canContinue() || this.submitting()) return;
    const last = this.questionIndex() >= this.visibleQuestions().length - 1;
    if (!last) {
      this.questionIndex.update((index) => index + 1);
      return;
    }
    this.submitAnswers();
  }

  addKitToCart(): void {
    const kit = this.kit();
    if (!kit || this.adding()) return;

    const components = kit.items.map((item) => ({
      product: item.product as unknown as CartProduct,
      variantSku: item.variantSku,
      slotLabel: item.slotLabel
    }));

    const bundle = createKitBundle({
      kitType: kit.kitType,
      packSize: kit.packSize === 3 ? 3 : 2,
      components,
      title: kit.title,
      pricing: kit.pricing
    });

    this.adding.set(true);
    this.cart.addKitBundleToCart(bundle, 1, true, true);
    this.added.set(true);
    this.adding.set(false);
  }

  customize(): void {
    const kit = this.kit();
    if (!kit) return;

    const slots: Partial<Record<SlotKey, { productId: number; variantSku: string }>> = {};
    for (const item of kit.items) {
      slots[item.slotKey as SlotKey] = {
        productId: item.productId,
        variantSku: item.variantSku
      };
    }

    const firstSlot = (kit.items[0]?.slotKey || null) as SlotKey | null;
    this.bundleState.saveSnapshot({
      kitType: kit.kitType,
      packSize: kit.packSize === 3 ? 3 : 2,
      activeSlotKey: firstSlot,
      categoryFilter: kit.categoryFilter,
      slots,
      slotProductOrder: kit.slotProductOrder as Partial<Record<SlotKey, number[]>>
    });
    this.router.navigate(['/shop/build-your-bundle']);
  }

  openAuth(mode: 'login' | 'signup'): void {
    this.awaitingAccountSave = true;
    this.authModal.open(mode);
  }

  formatPrice(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  private submitAnswers(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const payload = this.visibleQuestions()
      .filter((question) => this.answers()[question.question_id])
      .map((question) => ({
        question_id: question.question_id,
        option_id: this.answers()[question.question_id]
      }));

    this.submitting.set(true);
    this.errorMessage.set('');
    this.quizApi.submit(payload, this.auth.isAuthenticated() ? null : this.quizApi.sessionId()).subscribe({
      next: (response) => {
        this.kit.set(response.result.kit);
        this.step.set('result');
        this.submitting.set(false);
        if (!this.auth.isAuthenticated()) {
          this.awaitingAccountSave = true;
        } else {
          this.awaitingAccountSave = false;
        }
      },
      error: (error) => {
        this.submitting.set(false);
        this.errorMessage.set(error?.error?.error || 'We could not build a starter kit from those answers.');
      }
    });
  }
}
