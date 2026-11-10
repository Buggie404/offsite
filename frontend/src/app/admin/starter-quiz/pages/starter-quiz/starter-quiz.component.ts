import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
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
import { LucideIconPickerComponent } from './lucide-icon-picker.component';
import {
  AdminStarterQuizService,
  KitBudget,
  KitDraft,
  KitDrink,
  KitLevel,
  KitSlot,
  KitStatus,
  QuizOption,
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
    LucideIconPickerComponent,
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
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewRequests = new Subject<void>();

  readonly roles = ROLE_OPTIONS;
  readonly drinks: KitDrink[] = ['matcha', 'coffee', 'mixed', 'any'];
  readonly levels: KitLevel[] = ['beginner', 'ritual', 'craft', 'any'];
  readonly budgets: { value: KitBudget; label: string }[] = [
    { value: 'under_60', label: '< $60' },
    { value: 'mid_60_120', label: '$60–120' },
    { value: 'over_120', label: '> $120' }
  ];
  readonly drinkChoices: { value: KitDrink; label: string }[] = [
    { value: 'matcha', label: 'Matcha' },
    { value: 'coffee', label: 'Coffee' },
    { value: 'mixed', label: 'Mixed' },
    { value: 'any', label: 'Any' }
  ];
  readonly levelChoices: { value: KitLevel; label: string }[] = [
    { value: 'beginner', label: 'Just starting' },
    { value: 'ritual', label: 'Ritual' },
    { value: 'craft', label: 'Craft' },
    { value: 'any', label: 'Any' }
  ];
  readonly budgetChoices: { value: KitBudget; label: string }[] = [
    { value: 'under_60', label: 'Under $60' },
    { value: 'mid_60_120', label: '$60–120' },
    { value: 'over_120', label: 'Over $120' }
  ];
  readonly tiers = ['Everyday Sip', 'Ritual', 'Craft'];
  readonly statuses: { value: KitStatus; label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' }
  ];
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
  confirmPublish = false;
  unpublished = false;
  localDirty = false;

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
    this.loading = this.questions.length === 0 && this.kits.length === 0;
    this.error = '';
    this.paint();
    this.api.getConfig().subscribe({
      next: (response) => {
        this.enabled = response.enabled;
        this.questions = response.questions;
        this.kits = response.kits;
        if (!this.selectedId || !this.questions.some((question) => question.question_id === this.selectedId)) {
          this.selectedId = this.questions[0]?.question_id || '';
        }
        this.resetDraft();
        this.unpublished = !!response.unpublished;
        this.localDirty = false;
        this.loading = false;
        this.paint();
        this.loadMetrics();
        this.runTest();
      },
      error: (error) => {
        this.loading = false;
        this.error = error?.error?.error || 'The quiz configuration could not be loaded.';
        this.paint();
      }
    });
  }

  private loadMetrics(): void {
    this.api.getKitMetrics().subscribe({
      next: (response) => {
        this.kits = response.kits;
        this.paint();
      }
    });
  }

  private paint(): void {
    this.cdr.markForCheck();
  }

  roleBadge(role: MatchingRole): string {
    return this.roles.find((item) => item.value === role)?.badge || role;
  }

  toggleQuiz(): void {
    this.enabled = !this.enabled;
    this.localDirty = true;
    this.error = '';
  }

  selectQuestion(question: QuizQuestion): void {
    if (question.question_id === this.selectedId) return;
    this.commitQuestion();
    this.selectedId = question.question_id;
    this.editingOptionId = '';
    this.resetDraft();
  }

  commitQuestion(): void {
    if (!this.draft) return;
    const current = this.questions.find((question) => question.question_id === this.draft?.question_id);
    if (current && JSON.stringify(current) === JSON.stringify(this.draft)) return;
    this.questions = this.questions.map((question) => (
      question.question_id === this.draft?.question_id ? structuredClone(this.draft!) : question
    ));
    this.localDirty = true;
  }

  onRoleChange(): void {
    if (!this.draft) return;
    const gap = this.roleGap(this.questionsWithDraft());
    if (gap) {
      const previous = this.questions.find((question) => question.question_id === this.draft?.question_id);
      if (previous) this.draft.matching_role = previous.matching_role;
      this.error = gap;
      this.paint();
      return;
    }
    this.error = '';
    this.commitQuestion();
  }

  addQuestion(): void {
    if (this.questions.length >= 6) return;
    this.commitQuestion();
    const question: QuizQuestion = {
      question_id: `SQ${Date.now()}`,
      code: `q${this.questions.length + 1}`,
      question: 'New question',
      order: this.questions.length + 1,
      matching_role: 'secondary',
      is_active: true,
      options: [{
        option_id: `OPT${Date.now()}`,
        text: 'New option',
        hint: '',
        icon: 'sparkles',
        code: 'new_option'
      }]
    };
    this.questions = [...this.questions, question];
    this.selectedId = question.question_id;
    this.localDirty = true;
    this.resetDraft();
  }

  askDelete(): void {
    if (!this.draft) return;
    const next = this.questions.filter((question) => question.question_id !== this.draft?.question_id);
    const gap = this.roleGap(next);
    if (gap) {
      this.error = gap;
      return;
    }
    this.confirmDelete = true;
  }

  deleteSelected(): void {
    const questionId = this.draft?.question_id;
    this.confirmDelete = false;
    if (!questionId) return;
    const next = this.questions
      .filter((question) => question.question_id !== questionId)
      .map((question, index) => ({ ...question, order: index + 1 }));
    const gap = this.roleGap(next);
    if (gap) {
      this.error = gap;
      return;
    }
    this.questions = next;
    this.selectedId = this.questions[0]?.question_id || '';
    this.localDirty = true;
    this.error = '';
    this.resetDraft();
  }

  addOption(): void {
    if (!this.draft) return;
    const index = this.draft.options.length + 1;
    this.draft.options = [
      ...this.draft.options,
      { option_id: `OPT${Date.now()}`, text: 'New option', hint: '', icon: 'sparkles', code: `option_${index}` }
    ];
    this.editingOptionId = this.draft.options[this.draft.options.length - 1].option_id;
    this.commitQuestion();
  }

  removeOption(optionId: string): void {
    if (!this.draft || this.draft.options.length < 2) return;
    this.draft.options = this.draft.options.filter((option) => option.option_id !== optionId);
    this.editingOptionId = '';
    this.commitQuestion();
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
    this.localDirty = true;
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
    if (this.kitForm.slots.length >= 3) return;
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

  removeSlot(slotId: string): void {
    if (this.kitForm.slots.length <= 2) return;
    this.kitForm.slots = this.kitForm.slots.filter((slot) => slot.slot_id !== slotId);
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
    this.kitError = '';
    const clash = this.kits.find((kit) => (
      kit.kit_id !== this.editingKitId
      && kit.status === 'active'
      && this.kitForm.status === 'active'
      && kit.drink === this.kitForm.drink
      && kit.level === this.kitForm.level
      && kit.budget === this.kitForm.budget
    ));
    if (clash) {
      this.kitError = `No overlap with other active kits. “${clash.name}” already uses this Drink + Level + Budget.`;
      return;
    }
    const kitId = this.editingKitId || `SK${Date.now()}`;
    const next: QuizKit = {
      kit_id: kitId,
      name: this.kitForm.name.trim(),
      tier: this.kitForm.tier,
      description: this.kitForm.description,
      image_url: this.kitForm.image_url,
      drink: this.kitForm.drink,
      level: this.kitForm.level,
      budget: this.kitForm.budget,
      budget_label: this.budgets.find((item) => item.value === this.kitForm.budget)?.label || this.kitForm.budget,
      discount_percent: 20,
      status: this.kitForm.status,
      display_status: this.kitForm.status,
      order: this.editingKitId
        ? (this.kits.find((kit) => kit.kit_id === kitId)?.order || this.kits.length + 1)
        : this.kits.length + 1,
      slots: this.kitForm.slots.map((slot) => ({ ...slot })),
      slot_summary: this.kitForm.slots.map((slot) => slot.name).join(' · '),
      stock: null,
      retail: null,
      bundle: null,
      price_label: ''
    };
    if (!next.name) {
      this.kitError = 'Kit name is required.';
      return;
    }
    this.kits = this.editingKitId
      ? this.kits.map((kit) => kit.kit_id === kitId ? next : kit)
      : [...this.kits, next];
    this.localDirty = true;
    this.kitOpen = false;
    this.api.previewKit({ ...this.kitForm, discount_percent: 20 }).subscribe({
      next: (response) => {
        this.kits = this.kits.map((kit) => kit.kit_id === kitId ? { ...response.kit, kit_id: kitId } : kit);
        this.paint();
      }
    });
  }

  queuePreview(): void {
    this.previewRequests.next();
  }

  runTest(): void {
    this.api.testRules({
      drink: this.testDrink,
      level: this.testLevel,
      budget: this.testBudget,
      kits: this.kitPayload()
    }).subscribe({
      next: (result) => {
        this.test = result;
        this.paint();
      }
    });
  }

  saveChanges(): void {
    this.commitQuestion();
    this.saving = true;
    this.api.saveDraft({
      enabled: this.enabled,
      questions: this.questions,
      kits: this.kitPayload()
    }).subscribe({
      next: (response) => {
        this.applyConfig(response);
        this.saving = false;
        this.unpublished = true;
        this.localDirty = false;
        this.error = '';
        this.loadMetrics();
        this.runTest();
        this.paint();
      },
      error: (error) => {
        this.saving = false;
        this.error = error?.error?.error || 'The draft could not be saved.';
        this.paint();
      }
    });
  }

  askPublish(): void {
    this.commitQuestion();
    this.confirmPublish = true;
  }

  confirmPublishChanges(): void {
    this.confirmPublish = false;
    const publish = () => {
      this.api.publish().subscribe({
        next: (response) => {
          this.applyConfig(response);
          this.saving = false;
          this.unpublished = false;
          this.localDirty = false;
          this.error = '';
          this.loadMetrics();
          this.runTest();
          this.paint();
        },
        error: (error) => {
          this.saving = false;
          this.error = error?.error?.error || 'The quiz could not be published.';
          this.paint();
        }
      });
    };
    if (!this.localDirty && this.unpublished) {
      this.saving = true;
      publish();
      return;
    }
    this.saving = true;
    this.api.saveDraft({
      enabled: this.enabled,
      questions: this.questions,
      kits: this.kitPayload()
    }).subscribe({
      next: () => publish(),
      error: (error) => {
        this.saving = false;
        this.error = error?.error?.error || 'The draft could not be saved.';
        this.paint();
      }
    });
  }

  money(amount: number | undefined): string {
    return `$${Number(amount || 0).toFixed(2)}`;
  }

  priceSpan(kit: QuizKit | null): string {
    if (!kit?.retail || !kit.bundle) return '';
    const same = Math.abs(kit.retail.min - kit.retail.max) < 0.001;
    const retail = same ? this.money(kit.retail.min) : `${this.money(kit.retail.min)}–${this.money(kit.retail.max)}`;
    const bundle = same ? this.money(kit.bundle.min) : `${this.money(kit.bundle.min)}–${this.money(kit.bundle.max)}`;
    return `${retail} → ${bundle}`;
  }

  listPrice(kit: QuizKit): string {
    if (!kit.retail || !kit.bundle) return '—';
    return `${this.money(kit.retail.min)} → ${this.money(kit.bundle.min)}`;
  }

  setLabel(question: QuizQuestion, option: QuizOption): string {
    const axis = question.matching_role === 'primary'
      ? 'drink'
      : question.matching_role === 'secondary'
        ? 'level'
        : question.matching_role === 'hard_filter'
          ? 'budget'
          : 'copy';
    return `${axis} = ${option.code || '—'}`;
  }

  private resetDraft(): void {
    this.draft = this.selected ? structuredClone(this.selected) : null;
  }

  private questionsWithDraft(): QuizQuestion[] {
    if (!this.draft) return this.questions;
    return this.questions.map((question) => (
      question.question_id === this.draft?.question_id ? this.draft! : question
    ));
  }

  private roleGap(questions: QuizQuestion[]): string | null {
    const active = questions.filter((question) => question.is_active !== false);
    const primary = active.some((question) => question.matching_role === 'primary');
    const hard = active.some((question) => question.matching_role === 'hard_filter');
    if (primary && hard) return null;
    return 'Keep at least one Primary question and one Hard filter question. Without them every kit matches.';
  }

  private kitPayload(): Array<KitDraft & { kit_id: string }> {
    return this.kits.map((kit) => ({
      kit_id: kit.kit_id,
      name: kit.name,
      tier: kit.tier,
      description: kit.description,
      image_url: kit.image_url,
      drink: kit.drink,
      level: kit.level,
      budget: kit.budget,
      discount_percent: 20,
      status: kit.status,
      slots: kit.slots.map((slot) => ({
        slot_id: slot.slot_id,
        name: slot.name,
        category: slot.category,
        attribute: slot.attribute,
        constraint: slot.constraint,
        hero: slot.hero
      }))
    }));
  }

  private applyConfig(response: { enabled: boolean; questions: QuizQuestion[]; kits: QuizKit[] }): void {
    this.enabled = response.enabled;
    this.questions = response.questions;
    this.kits = response.kits;
    if (!this.questions.some((question) => question.question_id === this.selectedId)) {
      this.selectedId = this.questions[0]?.question_id || '';
    }
    this.resetDraft();
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
        { slot_id: 'S1', name: 'Matcha powder', category: 'matcha', attribute: 'Any grade', constraint: 'Any price', hero: true },
        { slot_id: 'S2', name: 'Drinkware', category: 'drinkware', attribute: 'Any type', constraint: 'Any price', hero: false }
      ]
    };
  }
}
