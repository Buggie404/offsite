import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import {
  LucideEye,
  LucideFilter,
  LucideGripVertical,
  LucideInfo,
  LucidePencil,
  LucidePlus,
  LucideTrash2,
  LucideX,
  LucideArrowRight
} from '@lucide/angular';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import {
  AdminStarterQuizService,
  KitBudget,
  KitDraft,
  KitDrink,
  KitLevel,
  KitSlot,
  KitStatus,
  MatchingRole,
  QuizKit,
  QuizQuestion,
  RuleTest,
  SlotCategory
} from '../../services/admin-starter-quiz.service';

export const ROLE_OPTIONS: { value: MatchingRole; badge: string; select: string }[] = [
  { value: 'copy_only', badge: 'Copy only', select: 'Copy only · changes the result headline, not the products' },
  { value: 'primary', badge: 'Primary', select: 'Primary signal · decides product category of each slot' },
  { value: 'secondary', badge: 'Secondary', select: 'Secondary signal · must match the kit rule' },
  { value: 'hard_filter', badge: 'Hard filter', select: 'Hard filter · removes kits outside the answer' }
];

@Component({
  selector: 'app-admin-starter-quiz',
  standalone: true,
  imports: [
    LucideArrowRight,
    CommonModule,
    FormsModule,
    ConfirmationModalComponent,
    LucideEye,
    LucideFilter,
    LucideGripVertical,
    LucideInfo,
    LucidePencil,
    LucidePlus,
    LucideTrash2,
    LucideX
  ],
  templateUrl: './starter-quiz.component.html',
  styleUrl: './starter-quiz.component.scss'
})
export class AdminStarterQuizComponent implements OnInit {
  private readonly api = inject(AdminStarterQuizService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewRequests = new Subject<void>();

  readonly roles = ROLE_OPTIONS;
  readonly drinks: KitDrink[] = ['matcha', 'coffee', 'mixed', 'any'];
  readonly levels: KitLevel[] = ['beginner', 'ritual', 'craft', 'any'];
  readonly budgets: { value: KitBudget; label: string }[] = [
    { value: 'under_60', label: 'Under $60' },
    { value: 'mid_60_120', label: '$60–120' },
    { value: 'over_120', label: 'Over $120' }
  ];
  readonly tiers = ['Everyday Sip', 'Ritual', 'Craft'];
  readonly statuses: KitStatus[] = ['draft', 'active', 'suspended'];
  readonly constraints = ['Any price', 'Price ≤ $20', 'Price ≤ $40', 'Price ≤ $60', 'Size ≤ 50g'];

  tab: 'questions' | 'kits' = 'questions';
  loading = true;
  saving = false;
  enabled = true;
  error = '';
  questions: QuizQuestion[] = [];
  kits: QuizKit[] = [];
  selectedId = '';
  draft: QuizQuestion | null = null;
  editingOptionId = '';
  draggingId = '';
  confirmDelete = false;

  kitOpen = false;
  editingKitId = '';
  kitError = '';
  kitForm: KitDraft = this.emptyKit();
  kitPreview: QuizKit | null = null;

  testDrink: KitDrink = 'matcha';
  testLevel: KitLevel = 'beginner';
  testBudget: KitBudget = 'under_60';
  test: RuleTest | null = null;

  ngOnInit(): void {
    this.previewRequests.pipe(
      debounceTime(200),
      switchMap(() => this.api.previewKit(this.kitForm).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((response) => {
      this.kitPreview = response?.kit ?? null;
    });
    this.load();
  }

  get selected(): QuizQuestion | null {
    return this.questions.find((question) => question.question_id === this.selectedId) ?? null;
  }

  load(): void {
    this.loading = true;
    this.api.getConfig().subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.questions = response.questions;
        this.kits = response.kits;
        if (!this.selectedId || !this.questions.some((question) => question.question_id === this.selectedId)) {
          this.selectedId = this.questions[0]?.question_id || '';
        }
        this.resetDraft();
        this.loading = false;
        this.runTest();
      },
      error: (error) => {
        this.loading = false;
        this.error = error?.error?.error || 'The quiz configuration could not be loaded.';
      }
    });
  }

  roleBadge(role: MatchingRole): string {
    return this.roles.find((item) => item.value === role)?.badge || role;
  }

  toggleQuiz(event: Event): void {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    this.api.updateSettings(next).subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.error = '';
      },
      error: (error) => {
        input.checked = this.enabled;
        this.error = error?.error?.error || 'The quiz switch could not be saved.';
      }
    });
  }

  selectQuestion(question: QuizQuestion): void {
    if (question.question_id === this.selectedId) return;
    this.saveDraft(() => {
      this.selectedId = question.question_id;
      this.editingOptionId = '';
      this.resetDraft();
    });
  }

  saveDraft(done?: () => void): void {
    if (!this.draft) {
      done?.();
      return;
    }
    const current = this.selected;
    if (current && JSON.stringify(current) === JSON.stringify(this.draft)) {
      done?.();
      return;
    }
    this.saving = true;
    this.api.updateQuestion(this.draft.question_id, this.draft).subscribe({
      next: (response) => {
        this.questions = this.questions.map((question) => (
          question.question_id === response.question.question_id ? response.question : question
        ));
        if (this.selectedId === response.question.question_id) this.draft = structuredClone(response.question);
        this.saving = false;
        this.error = '';
        done?.();
      },
      error: (error) => {
        this.saving = false;
        this.error = error?.error?.error || 'The question could not be saved.';
      }
    });
  }

  addQuestion(): void {
    if (this.questions.length >= 6) return;
    this.api.createQuestion().subscribe({
      next: (response) => {
        this.questions = [...this.questions, response.question];
        this.selectedId = response.question.question_id;
        this.resetDraft();
      },
      error: (error) => {
        this.error = error?.error?.error || 'The question could not be added.';
      }
    });
  }

  askDelete(): void {
    if (this.draft) this.confirmDelete = true;
  }

  deleteSelected(): void {
    const questionId = this.draft?.question_id;
    this.confirmDelete = false;
    if (!questionId) return;
    this.api.deleteQuestion(questionId).subscribe({
      next: () => {
        this.questions = this.questions
          .filter((question) => question.question_id !== questionId)
          .map((question, index) => ({ ...question, order: index + 1 }));
        this.selectedId = this.questions[0]?.question_id || '';
        this.resetDraft();
      },
      error: (error) => {
        this.error = error?.error?.error || 'The question could not be deleted.';
      }
    });
  }

  addOption(): void {
    if (!this.draft) return;
    const index = this.draft.options.length + 1;
    this.draft.options = [
      ...this.draft.options,
      { option_id: `OPT${Date.now()}`, text: 'New option', hint: '', icon: '', code: `option_${index}` }
    ];
    this.editingOptionId = this.draft.options[this.draft.options.length - 1].option_id;
    this.saveDraft();
  }

  removeOption(optionId: string): void {
    if (!this.draft || this.draft.options.length < 2) return;
    this.draft.options = this.draft.options.filter((option) => option.option_id !== optionId);
    this.editingOptionId = '';
    this.saveDraft();
  }

  dragStart(questionId: string): void {
    this.draggingId = questionId;
  }

  dropOn(targetId: string): void {
    const from = this.questions.findIndex((question) => question.question_id === this.draggingId);
    const to = this.questions.findIndex((question) => question.question_id === targetId);
    this.draggingId = '';
    if (from < 0 || to < 0 || from === to) return;
    const next = [...this.questions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.questions = next.map((question, index) => ({ ...question, order: index + 1 }));
    if (this.draft) {
      const updated = this.questions.find((question) => question.question_id === this.draft?.question_id);
      if (updated) this.draft = { ...this.draft, order: updated.order };
    }
    this.api.reorderQuestions(this.questions.map((question) => question.question_id)).subscribe({
      error: (error) => {
        this.error = error?.error?.error || 'The question order could not be saved.';
        this.load();
      }
    });
  }

  openAddKit(): void {
    this.editingKitId = '';
    this.kitError = '';
    this.kitForm = this.emptyKit();
    this.kitPreview = null;
    this.kitOpen = true;
    this.previewRequests.next();
  }

  openEditKit(kit: QuizKit): void {
    this.editingKitId = kit.kit_id;
    this.kitError = '';
    this.kitForm = {
      name: kit.name,
      tier: kit.tier,
      description: kit.description,
      image_url: kit.image_url,
      drink: kit.drink,
      level: kit.level,
      budget: kit.budget,
      discount_percent: kit.discount_percent,
      status: kit.status,
      slots: kit.slots.map((slot) => ({ ...slot }))
    };
    this.kitOpen = true;
    this.previewRequests.next();
  }

  closeKit(): void {
    this.kitOpen = false;
    this.kitError = '';
  }

  addSlot(): void {
    this.kitForm.slots = [
      ...this.kitForm.slots,
      {
        slot_id: `S${Date.now()}`,
        name: 'New slot',
        category: 'matcha',
        attribute: 'Any grade',
        constraint: 'Any price',
        hero: false
      }
    ];
    this.previewRequests.next();
  }

  attributesFor(category: SlotCategory): string[] {
    if (category === 'matcha') return ['Any grade', 'Ceremonial', 'Premium', 'Barista', 'Culinary grade'];
    if (category === 'coffee') return ['Any roast', 'Light roast', 'Medium roast', 'Dark roast'];
    if (category === 'tools') return ['Any type', 'Type: Chasen', 'Type: Dripper', 'Type: Brewer', 'Type: Kettle', 'Type: Scoop'];
    return ['Any type', 'Type: Mug', 'Type: Cup', 'Type: Bowl', 'Type: Bottle'];
  }

  changeCategory(slot: KitSlot): void {
    const attributes = this.attributesFor(slot.category);
    if (!attributes.includes(slot.attribute)) slot.attribute = attributes[0];
    this.previewRequests.next();
  }

  setHero(slot: KitSlot, hero: boolean): void {
    this.kitForm.slots = this.kitForm.slots.map((item) => ({
      ...item,
      hero: item.slot_id === slot.slot_id ? hero : hero ? false : item.hero
    }));
    this.previewRequests.next();
  }

  slotPreview(slotId: string): KitSlot | undefined {
    return this.kitPreview?.slots.find((slot) => slot.slot_id === slotId);
  }

  saveKit(): void {
    this.saving = true;
    this.kitError = '';
    const request = this.editingKitId
      ? this.api.updateKit(this.editingKitId, this.kitForm)
      : this.api.createKit(this.kitForm);
    request.subscribe({
      next: () => {
        this.saving = false;
        this.kitOpen = false;
        this.load();
      },
      error: (error) => {
        this.saving = false;
        this.kitError = error?.error?.error || 'The kit could not be saved.';
      }
    });
  }

  queuePreview(): void {
    this.previewRequests.next();
  }

  runTest(): void {
    this.api.testRules({ drink: this.testDrink, level: this.testLevel, budget: this.testBudget }).subscribe({
      next: (result) => {
        this.test = result;
      }
    });
  }

  money(amount: number | undefined): string {
    return `$${Number(amount || 0).toFixed(2)}`;
  }

  priceSpan(kit: QuizKit): string {
    const same = Math.abs(kit.retail.min - kit.retail.max) < 0.001;
    const retail = same ? this.money(kit.retail.min) : `${this.money(kit.retail.min)}–${this.money(kit.retail.max)}`;
    const bundle = same ? this.money(kit.bundle.min) : `${this.money(kit.bundle.min)}–${this.money(kit.bundle.max)}`;
    return `${retail} → ${bundle}`;
  }

  private resetDraft(): void {
    this.draft = this.selected ? structuredClone(this.selected) : null;
  }

  private emptyKit(): KitDraft {
    return {
      name: '',
      tier: 'Everyday Sip',
      description: '',
      image_url: '',
      drink: 'matcha',
      level: 'beginner',
      budget: 'under_60',
      discount_percent: 20,
      status: 'draft',
      slots: [
        { slot_id: 'S1', name: 'Matcha powder', category: 'matcha', attribute: 'Any grade', constraint: 'Any price', hero: true }
      ]
    };
  }
}
