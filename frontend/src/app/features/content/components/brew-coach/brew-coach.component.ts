import { ChangeDetectorRef, Component, EventEmitter, HostListener, Input, NgZone, OnDestroy, OnInit, Output, effect, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideArchive, LucideArrowLeft, LucideCheck, LucideChevronDown, LucideMinus, LucidePlus, LucideShare2, LucideSparkle, LucideStar, LucideTrash2, LucideVolume1, LucideVolume2, LucideVolumeX, LucideX } from '@lucide/angular';
import { Recipe } from '../../../../shared/models/recipe.model';
import { ToastService } from '../../../../shared/services/toast.service';
import { AuthService } from '../../../../core/auth.service';
import { AuthModalService } from '../../../../core/auth-modal.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';
import { CoachStepView, buildCoachSteps } from './brew-coach.mapper';
import {
  brewProgressKey,
  brewReviewKey,
  currentBrewOwnerId,
  legacyBrewProgressKey,
  legacyBrewReviewKey,
  readScopedItem,
  removeScopedItem,
  writeScopedItem,
} from './brew-progress';
import { BrewSessionPayload, BrewSessionService } from './brew-session.service';
import { PantryCoverage, PantryCoverageItem, PantryCoverageRow } from '../../../account/components/my-pantry/pantry.model';
import { PantryService } from '../../../account/components/my-pantry/pantry.service';

interface ReviewRow {
  id: number;
  ingredientIndex: number;
  amount: number;
  powderGrams: number | null;
  powderFollowsAmount: boolean;
}

interface SavedAdjustment {
  name: string;
  unit: string;
  amount: number;
  original: number;
  powderGrams: number | null;
}

interface SavedBrewReview {
  rating: number;
  intensity: number;
  adjustRecipe: boolean;
  note: string;
  adjustments: SavedAdjustment[];
  savedAt: string;
  bannerHidden: boolean;
  recordAdjustments?: boolean;
}

interface LastBrewChange {
  name: string;
  from: string;
  to: string;
}

interface StepNeed {
  name: string;
  amount: string;
  change: LastBrewChange | null;
}

interface PantryChoice {
  name: string;
  productName: string;
  deductLabel: string;
  candidates: PantryCoverageRow['candidates'];
  selectedId: string;
}

interface StashedBrewReview {
  keys: string[];
  review: SavedBrewReview;
}

@Component({
  selector: 'app-brew-coach',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideArchive,
    LucideArrowLeft,
    LucideCheck,
    LucideShare2,
    LucideChevronDown,
    LucideMinus,
    LucidePlus,
    LucideSparkle,
    LucideStar,
    LucideTrash2,
    LucideVolume1,
    LucideVolume2,
    LucideVolumeX,
    LucideX,
  ],
  templateUrl: './brew-coach.component.html',
  styleUrl: './brew-coach.component.scss',
})
export class BrewCoachComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private authModal = inject(AuthModalService);
  private authPrompt = inject(AuthPromptModalService);
  private brewSessions = inject(BrewSessionService);
  private pantry = inject(PantryService);
  private router = inject(Router);

  @Input({ required: true }) recipe!: Recipe;
  @Input() pantrySelections: { ingredient_name: string; pantry_item_id: string }[] | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() brewSaved = new EventEmitter<PantryCoverage | null>();

  steps: CoachStepView[] = [];
  stepIndex = 0;
  completedUntil = 0;
  voiceOn = false;
  reviewOpen = false;
  exitConfirmOpen = false;
  rating = 4;
  hoverRating = 0;
  intensity = 4;
  adjustRecipe = true;
  reviewNote = '';
  reviewRows: ReviewRow[] = [];
  savedReview: SavedBrewReview | null = null;
  savedOpen = false;
  saving = false;
  saveError = '';
  awaitingAuth = false;
  adjustmentHidden = false;
  readonly stars = [1, 2, 3, 4, 5];
  readonly ratingLabels = ['', 'Not for me', 'Okay', 'Good', 'Really good', 'Excellent'];
  elapsed = 0;
  timerLeft = 0;
  timerTotal = 0;
  timerRunning = false;
  ringOffset = 0;
  ringTransition = 'none';
  private remainingMs = 0;

  readonly circumference = 2 * Math.PI * 96;

  private readonly compactUnits = ['g', 'kg', 'ml', 'l', 'oz', 'lb'];
  private nextReviewRowId = 1;
  private timerMemory = new Map<number, { leftMs: number; total: number }>();
  private restoredTimerLeft: number | null = null;
  private restoredTimerTotal: number | null = null;
  private elapsedHandle: number | null = null;
  private clockHandle: number | null = null;
  private timerEndsAt = 0;
  private ringToken = 0;
  private previousBodyOverflow = '';
  private previousHtmlOverflow = '';
  private pendingReview: SavedBrewReview | null = null;
  private amountDrafts = new Map<number, string>();
  private powderDrafts = new Map<number, string>();
  private adjustmentStepCache = new Map<string, number[]>();
  private readonly pendingReviewKey = 'offsite.pendingBrewReview';
  private destroyed = false;
  private coverageRows: PantryCoverageRow[] = [];
  private pantrySelection = new Map<string, string>();
  private savedToServer = false;
  private savedCoverage: PantryCoverage | null = null;
  private brewFinished = false;
  private discardProgress = false;
  private sessionStartedAt = new Date();

  constructor() {
    effect(() => {
      const authed = this.auth.isAuthenticated();
      const promptOpen = this.authPrompt.isOpen();
      const modalOpen = this.authModal.isOpen();
      const successOpen = this.authModal.successOpen();
      if (!this.awaitingAuth || this.saving) return;
      const authUiOpen = promptOpen || modalOpen || successOpen;
      const review = this.pendingReview ?? this.readStashedReview();
      if (authed && !promptOpen && !modalOpen && !successOpen && review) {
        void this.commitReview(review, { returnToRecipe: true });
        return;
      }
      if (!authed && !authUiOpen && !this.authPrompt.shouldStayOnPage()) {
        this.awaitingAuth = false;
        this.pendingReview = null;
        this.clearStashedReview();
        this.authPrompt.clearResume('save-brew');
      }
    });
  }

  get step(): CoachStepView {
    return this.steps[this.stepIndex];
  }

  get shownRating(): number {
    return this.hoverRating || this.rating;
  }

  get intensityFill(): string {
    return `${((this.intensity - 1) / 4) * 100}%`;
  }

  get signedIn(): boolean {
    return this.hasSession();
  }

  get exitNote(): string {
    const place = `step ${this.stepIndex + 1} of ${this.steps.length}`;
    if (this.keepsPersonalRecipe()) {
      return `This session stays in My Pantry at ${place}. Leave now and pick the brew back up whenever you like.`;
    }
    return 'This brew is not saved for a guest. Sign in to keep your place in My Pantry.';
  }

  get reviewLead(): string {
    if (!this.signedIn) {
      return 'Finish without saving, or sign in to keep a rating. A guest review is not stored.';
    }
    return 'Save your rating and log what you used.';
  }

  get hasPreviousTweaks(): boolean {
    return (this.savedReview?.adjustments || []).some(item => this.adjustmentMatters(item))
      || this.coverageAdjustments().length > 0
      || !!this.savedNote;
  }

  get savedNote(): string {
    if (!this.savedReview?.adjustRecipe) return '';
    return this.savedReview.note.trim();
  }

  get lastBrewChanges(): LastBrewChange[] {
    if (!this.savedReview?.adjustRecipe) return [];
    return this.savedReview.adjustments
      .filter(item => item.name && this.roundAmount(item.amount) !== this.roundAmount(item.original))
      .map(item => ({
        name: item.name,
        from: this.formatMeasure(item.original, item.unit),
        to: this.formatMeasure(item.amount, item.unit),
      }));
  }

  get showSavedBanner(): boolean {
    if (this.adjustmentHidden || this.savedReview?.bannerHidden) return false;
    return !!this.savedNote;
  }

  get showAdjustmentBanner(): boolean {
    if (this.adjustmentHidden) return false;
    return this.showSavedBanner || this.hasAdjustment(this.step);
  }

  get adjustmentLabel(): string {
    if (this.showSavedBanner) return 'Adjusted from your last brew';
    return this.step.adjustment?.label || 'Adjusted from your last brew';
  }

  get adjustmentMessage(): string {
    if (this.showSavedBanner) return this.savedNote;
    return this.step.adjustment?.message?.trim() || '';
  }

  get visibleChanges(): LastBrewChange[] {
    const adjustment = this.step.adjustment;
    if (this.showSavedBanner || !this.hasAdjustment(this.step) || !adjustment) return [];
    return [{ name: '', from: adjustment.from, to: adjustment.to }];
  }

  get timerStatus(): string {
    if (!this.timerTotal) return 'Ready';
    if (this.timerLeft <= 0) return "Time's up";
    if (this.timerRunning) return 'Running';
    if (this.timerLeft < this.timerTotal) return 'Paused';
    return 'Ready';
  }

  get timerButtonLabel(): string {
    if (this.timerTotal > 0 && this.timerLeft <= 0) return 'Done';
    if (this.timerRunning) return 'Pause';
    if (this.timerLeft < this.timerTotal) return 'Resume';
    return 'Start';
  }

  ngOnInit(): void {
    if (this.keepsPersonalRecipe()) {
      this.savedReview = this.readSavedReview();
      if (this.savedReview) {
        this.adjustRecipe = this.savedReview.adjustRecipe;
        this.reviewNote = this.savedReview.note;
        if (this.savedReview.rating) this.rating = this.savedReview.rating;
        if (this.savedReview.intensity) this.intensity = this.savedReview.intensity;
      }
    } else {
      this.resetPersonalRecipe();
    }
    this.steps = buildCoachSteps(this.recipe);
    this.restoreProgress();
    this.applyIncomingSelections();
    this.brewFinished = this.reviewOpen || this.completedUntil >= this.steps.length;
    this.restoreTimer();
    if (this.reviewOpen) this.ensureReviewRows();
    this.resumePendingSave();

    if (!isPlatformBrowser(this.platformId)) return;
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    this.persistProgress();
    void this.loadPantryCoverage();
    this.elapsedHandle = window.setInterval(() => {
      this.elapsed += 1;
      if (this.elapsed % 5 === 0) this.persistProgress();
      this.cdr.markForCheck();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.pauseTimer();
    if (!this.savedToServer && !this.discardProgress) this.persistProgress();
    if (this.elapsedHandle != null) window.clearInterval(this.elapsedHandle);
    if (isPlatformBrowser(this.platformId)) {
      document.body.style.overflow = this.previousBodyOverflow;
      document.documentElement.style.overflow = this.previousHtmlOverflow;
      window.speechSynthesis?.cancel();
    }
  }

  @HostListener('document:visibilitychange')
  onVisibility(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (document.visibilityState === 'hidden') {
      this.persistProgress();
      return;
    }
    if (!this.timerRunning) return;
    const ms = this.currentRemainingMs();
    if (ms <= 0) {
      this.finishTimer();
      this.cdr.markForCheck();
      return;
    }
    this.timerLeft = this.secondsLeft(ms);
    this.snapRing(ms, ms);
    this.armClock();
    this.cdr.markForCheck();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.awaitingAuth || this.authPrompt.isOpen() || this.authModal.isOpen() || this.authModal.successOpen()) return;
    if (this.exitConfirmOpen) {
      this.stayInBrew();
      return;
    }
    if (this.savedOpen) {
      this.backToRecipe();
      return;
    }
    if (this.reviewOpen) {
      this.closeReview();
      return;
    }
    this.askToExit();
  }

  askToExit(): void {
    this.exitConfirmOpen = true;
  }

  stayInBrew(): void {
    this.exitConfirmOpen = false;
  }

  confirmExit(): void {
    this.exitConfirmOpen = false;
    this.exit();
  }

  onExitBackdrop(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    this.stayInBrew();
  }

  exit(): void {
    this.pauseTimer();
    if (isPlatformBrowser(this.platformId)) window.speechSynthesis?.cancel();
    if (this.reviewOpen && this.brewFinished && !this.savedToServer && !this.awaitingAuth && !this.saving) {
      this.reviewOpen = false;
      this.discardProgress = true;
      this.clearProgress();
    }
    if (this.savedToServer || (this.brewFinished && this.hasSession())) this.brewSaved.emit(this.savedCoverage);
    this.closed.emit();
  }

  backToRecipe(): void {
    this.savedOpen = false;
    this.exit();
  }

  toggleVoice(): void {
    this.voiceOn = !this.voiceOn;
    if (!this.voiceOn) {
      if (isPlatformBrowser(this.platformId)) window.speechSynthesis?.cancel();
      return;
    }
    this.readAloud();
  }

  readAloud(): void {
    const step = this.step;
    this.speak([step.title, step.description].filter(Boolean).join('. '));
  }

  isDone(index: number): boolean {
    return index < this.completedUntil && index !== this.stepIndex;
  }

  goTo(index: number): void {
    if (this.reviewOpen) {
      this.closeReview();
      if (this.reviewOpen) return;
    }
    if (index < 0 || index >= this.steps.length || index === this.stepIndex) return;
    this.persistTimer();
    this.pauseTimer();
    this.stepIndex = index;
    this.restoreTimer();
    this.persistProgress();
    if (this.voiceOn) this.readAloud();
    this.cdr.markForCheck();
  }

  previous(): void {
    this.goTo(this.stepIndex - 1);
  }

  finishOrNext(): void {
    this.completedUntil = Math.max(this.completedUntil, this.stepIndex + 1);
    if (this.stepIndex >= this.steps.length - 1) {
      this.persistTimer();
      this.pauseTimer();
      this.brewFinished = true;
      this.adjustRecipe = false;
      this.reviewOpen = true;
      this.persistProgress();
      if (this.voiceOn) this.speak('How was it?');
      this.cdr.markForCheck();
      return;
    }
    this.goTo(this.stepIndex + 1);
  }

  setRating(value: number): void {
    this.rating = value;
  }

  setAdjustRecipe(on: boolean): void {
    this.adjustRecipe = on;
    if (on) this.ensureReviewRows();
  }

  closeReview(): void {
    if (this.saving || this.awaitingAuth) return;
    this.reviewOpen = false;
    this.persistProgress();
  }

  onReviewBackdrop(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    this.closeReview();
  }

  skipReview(): void {
    if (this.saving || this.awaitingAuth) return;
    this.reviewOpen = false;
    this.brewFinished = true;
    this.discardProgress = true;
    this.clearProgress();
    this.exit();
  }

  setIntensity(event: Event): void {
    this.intensity = Number((event.target as HTMLInputElement).value);
  }

  ingredientTaken(index: number, row: ReviewRow): boolean {
    return this.reviewRows.some(item => item.id !== row.id && item.ingredientIndex === index);
  }

  changeIngredient(row: ReviewRow, index: number): void {
    this.amountDrafts.delete(row.id);
    this.powderDrafts.delete(row.id);
    row.ingredientIndex = Number(index);
    row.amount = this.startingAmount(row.ingredientIndex);
    this.applyPowderState(row);
  }

  nudgeAmount(row: ReviewRow, direction: number): void {
    this.amountDrafts.delete(row.id);
    row.amount = this.roundAmount(Math.max(0, row.amount + direction));
    this.syncPowder(row);
  }

  amountField(row: ReviewRow): string {
    return this.amountDrafts.get(row.id) ?? this.formatAmount(row.amount);
  }

  onAmountType(row: ReviewRow, raw: string): void {
    const normalized = this.normalizeAmountText(raw);
    this.amountDrafts.set(row.id, normalized);
    if (normalized === '' || normalized === '.') return;
    const value = Number(normalized);
    if (Number.isFinite(value) && value >= 0) {
      row.amount = this.roundAmount(value);
      this.syncPowder(row);
    }
  }

  commitAmount(row: ReviewRow): void {
    const draft = this.amountDrafts.get(row.id);
    this.amountDrafts.delete(row.id);
    if (draft == null || draft === '' || draft === '.') return;
    const value = Number(draft);
    if (Number.isFinite(value) && value >= 0) {
      row.amount = this.roundAmount(value);
      this.syncPowder(row);
    }
  }

  showsPowder(row: ReviewRow): boolean {
    return this.tracksPowder(row.ingredientIndex);
  }

  get showsPowderNote(): boolean {
    return this.adjustRecipe && this.reviewRows.some(row => this.showsPowder(row));
  }

  powderField(row: ReviewRow): string {
    const draft = this.powderDrafts.get(row.id);
    if (draft != null) return draft;
    return row.powderGrams == null ? '' : this.formatAmount(row.powderGrams);
  }

  onPowderType(row: ReviewRow, raw: string): void {
    const normalized = this.normalizeAmountText(raw);
    this.powderDrafts.set(row.id, normalized);
    if (normalized === '' || normalized === '.') return;
    const value = Number(normalized);
    if (Number.isFinite(value) && value >= 0) this.setPowder(row, value);
  }

  commitPowder(row: ReviewRow): void {
    const draft = this.powderDrafts.get(row.id);
    this.powderDrafts.delete(row.id);
    if (draft == null || draft === '' || draft === '.') return;
    const value = Number(draft);
    if (Number.isFinite(value) && value >= 0) this.setPowder(row, value);
  }

  nudgePowder(row: ReviewRow, direction: number): void {
    this.powderDrafts.delete(row.id);
    const current = row.powderGrams ?? this.derivedPowder(row.amount, this.unitOf(row)) ?? 0;
    this.setPowder(row, Math.max(0, current + direction));
  }

  needsFor(step: CoachStepView, index: number): StepNeed[] {
    const rows = step.needs.map(need => ({
      name: need.name,
      amount: need.amount,
      change: need.amount === 'tool' || !this.adjustmentSteps(need.name).includes(index)
        ? null
        : this.changeForName(need.name) || this.coverageChange(need.name),
    }));

    for (const change of this.lastBrewChanges) {
      if (!this.adjustmentSteps(change.name).includes(index)) continue;
      if (rows.some(row => row.change && this.namesMatch(row.change.name, change.name))) continue;
      rows.push({
        name: this.shortIngredientName(change.name),
        amount: change.from,
        change,
      });
    }

    return rows;
  }

  get pantryChoices(): PantryChoice[] {
    return this.coverageRows.flatMap(row => {
      const candidates = row.candidates || [];
      if (row.staple || !candidates.length || !(row.drawQuantity != null && row.drawQuantity > 0)) return [];
      const selectedId = this.selectedPantryId(row.name, candidates);
      const selected = candidates.find(item => item.id === selectedId) || candidates[0];
      return [{
        name: row.name,
        productName: selected?.name || '',
        deductLabel: this.deductLabel(row),
        candidates,
        selectedId,
      }];
    });
  }

  pantryChoiceFor(name: string): PantryChoice | null {
    const key = this.normalizeIngredient(name);
    return this.pantryChoices.find(choice => this.normalizeIngredient(choice.name) === key) ?? null;
  }

  removeRow(row: ReviewRow): void {
    this.amountDrafts.delete(row.id);
    this.powderDrafts.delete(row.id);
    this.reviewRows = this.reviewRows.filter(item => item.id !== row.id);
  }

  addReviewRow(): void {
    const ingredientIndex = this.recipe.ingredients.findIndex((_, index) =>
      this.reviewRows.every(row => row.ingredientIndex !== index)
    );
    if (ingredientIndex < 0) return;
    this.reviewRows = [...this.reviewRows, this.makeReviewRow(ingredientIndex)];
  }

  canAddIngredient(): boolean {
    return this.reviewRows.length < this.recipe.ingredients.length;
  }

  unitOf(row: ReviewRow): string {
    return (this.recipe.ingredients[row.ingredientIndex]?.unit || '').trim();
  }

  formatAmount(value: number): string {
    const rounded = this.roundAmount(value);
    return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
  }

  formatDelta(row: ReviewRow): string {
    const delta = this.roundAmount(row.amount - this.originalAmount(row.ingredientIndex));
    if (!delta) return '';
    const absolute = this.formatAmount(Math.abs(delta));
    return delta > 0 ? `(+${absolute})` : `(−${absolute})`;
  }

  deltaDirection(row: ReviewRow): 'up' | 'down' | '' {
    const delta = this.roundAmount(row.amount - this.originalAmount(row.ingredientIndex));
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return '';
  }

  dismissAdjustment(): void {
    const persist = this.showSavedBanner;
    this.adjustmentHidden = true;
    if (!persist || !this.savedReview) return;
    this.savedReview = { ...this.savedReview, bannerHidden: true };
    this.persistReview(this.savedReview);
  }

  saveReview(event: Event): void {
    event.preventDefault();
    if (this.saving || this.awaitingAuth || this.savedOpen) return;
    this.saveError = '';
    const review = this.buildReview();
    this.persistProgress();
    if (!this.auth.isAuthenticated()) {
      this.pendingReview = review;
      this.awaitingAuth = true;
      this.stashPendingReview(review);
      const recipeKey = this.recipe.slug || this.recipe.recipe_id || this.recipe._id;
      if (recipeKey) {
        this.authPrompt.arm({ action: 'save-brew', slug: recipeKey });
      }
      this.authPrompt.open();
      return;
    }
    void this.commitReview(review);
  }

  viewPantry(): void {
    this.exit();
    void this.router.navigate(['/account'], { queryParams: { tab: 'pantry' } });
  }

  shareToCommunity(): void {
    this.exit();
    void this.router.navigate(['/community']);
  }

  startOrPause(): void {
    if (this.timerTotal > 0 && this.currentRemainingMs() <= 0) {
      this.finishOrNext();
      return;
    }
    if (this.timerRunning) {
      this.pauseTimer();
      this.persistProgress();
      this.cdr.markForCheck();
      return;
    }
    if (this.remainingMs <= 0) {
      const seconds = this.step?.timerSeconds ?? 0;
      if (seconds <= 0) return;
      this.timerTotal = seconds;
      this.remainingMs = seconds * 1000;
      this.timerLeft = seconds;
    }
    this.timerRunning = true;
    this.timerEndsAt = Date.now() + this.remainingMs;
    this.snapRing(this.remainingMs, this.remainingMs);
    this.armClock();
    this.cdr.markForCheck();
  }

  addTenSeconds(): void {
    this.captureRemaining();
    this.timerTotal += 10;
    this.remainingMs += 10000;
    if (this.timerRunning) this.timerEndsAt = Date.now() + this.remainingMs;
    this.timerLeft = this.secondsLeft(this.remainingMs);
    this.snapRing(this.remainingMs, this.timerRunning ? this.remainingMs : null);
    this.persistProgress();
    this.cdr.markForCheck();
  }

  resetTimer(): void {
    this.pauseTimer();
    const seconds = this.step?.timerSeconds ?? 0;
    this.timerLeft = seconds;
    this.timerTotal = seconds;
    this.remainingMs = seconds * 1000;
    this.snapRing(this.remainingMs, null);
    this.persistProgress();
    this.cdr.markForCheck();
  }

  formatClock(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  hasAdjustment(step: CoachStepView): boolean {
    const adjustment = step.adjustment;
    return !!adjustment?.message.trim() && !!adjustment.from.trim() && !!adjustment.to.trim();
  }

  nextPreviewLabel(step: CoachStepView): string {
    if (step.timerSeconds) return `Up next · Timer ${this.formatClock(step.timerSeconds)}`;
    return 'Up next · At your pace';
  }

  private adoptCoverageAdjustments(): void {
    if (!this.adjustRecipe) return;
    this.ensureReviewRows();
    for (const row of this.reviewRows) {
      const ingredient = this.recipe.ingredients[row.ingredientIndex];
      if (ingredient?.quantity == null) continue;
      if (this.roundAmount(row.amount) !== this.roundAmount(ingredient.quantity)) continue;
      const next = this.startingAmount(row.ingredientIndex);
      if (this.roundAmount(next) === this.roundAmount(row.amount)) continue;
      row.amount = next;
      this.applyPowderState(row);
    }
  }

  private ensureReviewRows(): void {
    const previous = this.previouslyAdjustedIndexes();
    if (previous.length) {
      const have = new Set(this.reviewRows.map(row => row.ingredientIndex));
      const missing = previous.filter(index => !have.has(index));
      if (!this.reviewRows.length) {
        this.reviewRows = previous.map(index => this.makeReviewRow(index));
        return;
      }
      if (missing.length) {
        this.reviewRows = [...this.reviewRows, ...missing.map(index => this.makeReviewRow(index))];
      }
      return;
    }
    if (this.reviewRows.length || !this.recipe.ingredients.length) return;
    const count = Math.min(2, this.recipe.ingredients.length);
    this.reviewRows = Array.from({ length: count }, (_, ingredientIndex) => this.makeReviewRow(ingredientIndex));
  }

  private makeReviewRow(ingredientIndex: number): ReviewRow {
    const amount = this.startingAmount(ingredientIndex);
    const row: ReviewRow = {
      id: this.nextReviewRowId++,
      ingredientIndex,
      amount,
      powderGrams: null,
      powderFollowsAmount: true,
    };
    this.applyPowderState(row);
    return row;
  }

  private previouslyAdjustedIndexes(): number[] {
    const indexes: number[] = [];
    for (const item of this.savedReview?.adjustments || []) {
      if (!this.adjustmentMatters(item)) continue;
      const index = this.recipe.ingredients.findIndex(ingredient =>
        ingredient.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      );
      if (index >= 0 && !indexes.includes(index)) indexes.push(index);
    }
    this.recipe.ingredients.forEach((ingredient, index) => {
      if (indexes.includes(index) || ingredient.quantity == null) return;
      const row = this.coverageRowFor(ingredient.name);
      if (!row || row.quantity == null) return;
      if (this.roundAmount(row.quantity) !== this.roundAmount(ingredient.quantity)) indexes.push(index);
    });
    return indexes;
  }

  private originalAmount(index: number): number {
    return this.recipe.ingredients[index]?.quantity ?? 0;
  }

  private startingAmount(index: number): number {
    const saved = this.savedAdjustment(index);
    if (saved) return saved.amount;
    const ingredient = this.recipe.ingredients[index];
    const row = ingredient ? this.coverageRowFor(ingredient.name) : null;
    if (ingredient?.quantity != null && row?.quantity != null
      && this.roundAmount(row.quantity) !== this.roundAmount(ingredient.quantity)) {
      return row.quantity;
    }
    return this.originalAmount(index);
  }

  private savedAdjustment(index: number): SavedAdjustment | null {
    const ingredient = this.recipe.ingredients[index];
    if (!ingredient || !this.savedReview?.adjustRecipe) return null;
    return this.savedReview.adjustments.find(
      item => item.name.trim().toLowerCase() === ingredient.name.trim().toLowerCase()
    ) ?? null;
  }

  private applyIncomingSelections(): void {
    for (const row of this.pantrySelections || []) {
      const key = this.normalizeIngredient(row?.ingredient_name || '');
      if (!key || !row?.pantry_item_id || this.pantrySelection.has(key)) continue;
      this.pantrySelection.set(key, row.pantry_item_id);
    }
  }

  private applyPowderState(row: ReviewRow): void {
    if (!this.tracksPowder(row.ingredientIndex)) {
      row.powderGrams = null;
      row.powderFollowsAmount = true;
      return;
    }
    const saved = this.savedAdjustment(row.ingredientIndex);
    const derived = this.derivedPowder(row.amount, this.unitOf(row));
    if (saved?.powderGrams == null) {
      const drawn = this.coverageDrawGrams(row.ingredientIndex);
      if (drawn != null && derived != null && this.roundAmount(drawn) !== this.roundAmount(derived)) {
        row.powderGrams = drawn;
        row.powderFollowsAmount = false;
        return;
      }
      row.powderGrams = derived;
      row.powderFollowsAmount = true;
      return;
    }
    const savedDerived = this.derivedPowder(saved.amount, saved.unit);
    row.powderGrams = saved.powderGrams;
    row.powderFollowsAmount = savedDerived != null
      && this.roundAmount(saved.powderGrams) === this.roundAmount(savedDerived);
  }

  private syncPowder(row: ReviewRow): void {
    if (!row.powderFollowsAmount || !this.tracksPowder(row.ingredientIndex)) return;
    row.powderGrams = this.derivedPowder(row.amount, this.unitOf(row));
  }

  private setPowder(row: ReviewRow, value: number): void {
    const grams = this.roundAmount(value);
    row.powderGrams = grams;
    const derived = this.derivedPowder(row.amount, this.unitOf(row));
    row.powderFollowsAmount = derived != null && this.roundAmount(derived) === grams;
  }

  private tracksPowder(index: number): boolean {
    const ingredient = this.recipe.ingredients[index];
    if (!ingredient || !this.isPreparedPowder(ingredient.name)) return false;
    return this.derivedPowder(ingredient.quantity ?? 0, ingredient.unit || '') != null;
  }

  private isPreparedPowder(name: string): boolean {
    const label = name.toLowerCase();
    if (!/\b(prepared|brewed|whisked)\b/.test(label)) return false;
    return /matcha|hojicha|houjicha/.test(label);
  }

  private derivedPowder(quantity: number, unit: string): number | null {
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    const aliases: Record<string, string> = {
      teaspoon: 'tsp',
      teaspoons: 'tsp',
      tablespoon: 'tbsp',
      tablespoons: 'tbsp',
      cups: 'cup',
      ounce: 'oz',
      ounces: 'oz',
    };
    const key = aliases[unit.trim().toLowerCase()] || unit.trim().toLowerCase();
    const mlPer: Record<string, number> = { tsp: 5, tbsp: 15, cup: 240, oz: 30, ml: 1, l: 1000 };
    const per = mlPer[key];
    if (per == null) return null;
    return this.roundAmount((quantity * per) / 30);
  }

  private readPowder(value: unknown): number | null {
    if (value == null || value === '') return null;
    const grams = Number(value);
    return Number.isFinite(grams) && grams >= 0 ? grams : null;
  }

  private adjustmentMatters(item: SavedAdjustment): boolean {
    if (!item.name) return false;
    if (this.roundAmount(item.amount) !== this.roundAmount(item.original)) return true;
    const derived = this.derivedPowder(item.original, item.unit);
    return item.powderGrams != null && derived != null
      && this.roundAmount(item.powderGrams) !== this.roundAmount(derived);
  }

  private adjustmentPayload(review: SavedBrewReview): BrewSessionPayload['ingredient_adjustments'] {
    return review.adjustments.flatMap(item => {
      if (!this.adjustmentMatters(item)) return [];
      const prepared = this.isPreparedPowder(item.name) && item.powderGrams != null;
      return [{
        ingredient_name: item.name,
        delta_quantity: this.roundAmount(item.amount - item.original),
        unit: item.unit,
        deduct_quantity: prepared ? item.powderGrams : null,
        deduct_unit: prepared ? 'g' : '',
      }];
    });
  }

  private ingredientsUsed(review: SavedBrewReview): {
    name: string;
    quantity: number;
    unit: string;
    product_id: null;
  }[] {
    const amounts = new Map(
      review.adjustments
        .filter(item => item.name)
        .map(item => [item.name.trim().toLowerCase(), item.amount])
    );
    return this.recipe.ingredients.map(item => ({
      name: item.name,
      quantity: amounts.get(item.name.trim().toLowerCase()) ?? item.quantity ?? 0,
      unit: item.unit ?? '',
      product_id: null,
    }));
  }

  private recipeKey(): string {
    return this.recipe.recipe_id || this.recipe._id || this.recipe.slug;
  }

  private recipeKeys(): string[] {
    return [this.recipe.slug, this.recipe.recipe_id, this.recipe._id].filter((key): key is string => !!key);
  }

  private stashPendingReview(review: SavedBrewReview): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const payload: StashedBrewReview = { keys: this.recipeKeys(), review };
    sessionStorage.setItem(this.pendingReviewKey, JSON.stringify(payload));
  }

  private readStashedReview(): SavedBrewReview | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = sessionStorage.getItem(this.pendingReviewKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StashedBrewReview>;
      if (!parsed.review || !Array.isArray(parsed.keys) || !parsed.keys.some(key => this.recipeKeys().includes(key))) {
        return null;
      }
      return this.normalizeReview(parsed.review);
    } catch {
      return null;
    }
  }

  private clearStashedReview(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    sessionStorage.removeItem(this.pendingReviewKey);
  }

  private normalizeReview(parsed: Partial<SavedBrewReview>): SavedBrewReview | null {
    const adjustments = Array.isArray(parsed.adjustments)
      ? parsed.adjustments.flatMap(item => {
          if (!item || typeof item.name !== 'string') return [];
          const amount = Number(item.amount);
          const original = Number(item.original);
          if (!Number.isFinite(amount) || !Number.isFinite(original)) return [];
          return [{
            name: item.name,
            unit: typeof item.unit === 'string' ? item.unit : '',
            amount,
            original,
            powderGrams: this.readPowder(item.powderGrams),
          }];
        })
      : [];
    return {
      rating: Number(parsed.rating) || 0,
      intensity: Number(parsed.intensity) || 0,
      adjustRecipe: !!parsed.adjustRecipe,
      note: typeof parsed.note === 'string' ? parsed.note : '',
      adjustments,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      bannerHidden: !!parsed.bannerHidden,
      recordAdjustments: parsed.recordAdjustments === true,
    };
  }

  private normalizeAmountText(raw: string): string {
    const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    if (dot < 0) return cleaned;
    return `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, '')}`;
  }

  private selectedPantryId(name: string, candidates: PantryCoverageItem[]): string {
    const saved = this.pantrySelection.get(this.normalizeIngredient(name));
    if (saved && candidates.some(item => item.id === saved)) return saved;
    return candidates[0]?.id || '';
  }

  private deductLabel(row: PantryCoverageRow): string {
    if (row.drawQuantity == null || !row.drawUnit) return '';
    const qty = this.formatAmount(row.drawQuantity);
    const unit = row.drawUnit.trim();
    const compact = this.compactUnits.includes(unit.toLowerCase());
    return compact || !unit ? `Uses ${qty}${unit}` : `Uses ${qty} ${unit}`;
  }

  private hasSession(): boolean {
    return this.auth.isAuthenticated()
      || (isPlatformBrowser(this.platformId) && !!localStorage.getItem('token'));
  }

  private keepsPersonalRecipe(): boolean {
    return currentBrewOwnerId() !== 'guest';
  }

  private resetPersonalRecipe(): void {
    this.savedReview = null;
    this.adjustRecipe = false;
    this.reviewNote = '';
    this.reviewRows = [];
    this.rating = 4;
    this.intensity = 4;
    this.adjustmentHidden = false;
  }

  private loadPantryCoverage(): void {
    const recipeId = this.recipe?.recipe_id;
    if (!recipeId || !this.hasSession()) return;
    void this.pantry.coverage(recipeId).then(coverage => {
      if (this.destroyed) return;
      this.coverageRows = [...(coverage.ingredients || []), ...(coverage.tools || [])];
      this.adjustmentStepCache.clear();
      this.adoptCoverageAdjustments();
      this.cdr.markForCheck();
    }).catch(() => undefined);
  }

  private changeForName(name: string): LastBrewChange | null {
    return this.lastBrewChanges.find(change => this.namesMatch(change.name, name)) ?? null;
  }

  private coverageRowFor(name: string): PantryCoverageRow | null {
    const key = this.normalizeIngredient(name);
    if (!key) return null;
    return this.coverageRows.find(row => this.normalizeIngredient(row.name) === key) ?? null;
  }

  private coverageDrawGrams(index: number): number | null {
    const ingredient = this.recipe.ingredients[index];
    const row = ingredient ? this.coverageRowFor(ingredient.name) : null;
    if (!row || row.drawQuantity == null || row.drawUnit?.trim().toLowerCase() !== 'g') return null;
    return row.drawQuantity;
  }

  private coverageAdjustments(): SavedAdjustment[] {
    return this.recipe.ingredients.flatMap(ingredient => {
      if (ingredient.quantity == null) return [];
      const row = this.coverageRowFor(ingredient.name);
      if (!row || row.quantity == null || row.staple) return [];
      const unit = ingredient.unit || row.unit || '';
      const derived = this.isPreparedPowder(ingredient.name) ? this.derivedPowder(row.quantity, unit) : null;
      const drawn = row.drawUnit?.trim().toLowerCase() === 'g' ? row.drawQuantity : null;
      const amountChanged = this.roundAmount(row.quantity) !== this.roundAmount(ingredient.quantity);
      const powderChanged = derived != null && drawn != null && this.roundAmount(drawn) !== this.roundAmount(derived);
      if (!amountChanged && !powderChanged) return [];
      return [{
        name: ingredient.name,
        unit,
        amount: row.quantity,
        original: ingredient.quantity,
        powderGrams: this.isPreparedPowder(ingredient.name) ? (drawn ?? derived) : null,
      }];
    });
  }

  private coverageChange(name: string): LastBrewChange | null {
    const row = this.coverageRows.find(item => this.namesMatch(item.name, name));
    const ingredient = this.recipe.ingredients.find(item => this.namesMatch(item.name, name));
    if (!row || row.quantity == null || ingredient?.quantity == null) return null;
    if (this.roundAmount(row.quantity) === this.roundAmount(ingredient.quantity)) return null;
    const unit = row.unit || ingredient.unit || '';
    return {
      name: ingredient.name,
      from: this.formatMeasure(ingredient.quantity, unit),
      to: this.formatMeasure(row.quantity, unit),
    };
  }

  private namesMatch(ingredientName: string, needName: string): boolean {
    const ingredient = this.normalizeIngredient(ingredientName);
    const need = this.normalizeIngredient(needName);
    if (!ingredient || !need) return false;
    return ingredient === need || ingredient.includes(need) || need.includes(ingredient);
  }

  private normalizeIngredient(name: string): string {
    return this.shortIngredientName(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private shortIngredientName(name: string): string {
    const wrapped = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (!wrapped) return name.trim();
    if (/°/.test(wrapped[2])) return `${wrapped[1].trim()} ${wrapped[2].trim()}`;
    return wrapped[1].trim();
  }

  private adjustmentSteps(name: string): number[] {
    if (!this.changeForName(name) && !this.coverageChange(name)) return [];
    const key = this.normalizeIngredient(name);
    const cached = this.adjustmentStepCache.get(key);
    if (cached) return cached;
    const matches = this.steps
      .map((step, index) => this.stepUsesIngredient(step, name) ? index : -1)
      .filter(index => index >= 0);
    const indexes = matches.length ? matches : [0];
    this.adjustmentStepCache.set(key, indexes);
    return indexes;
  }

  private stepUsesIngredient(step: CoachStepView, name: string): boolean {
    const hay = `${step.title} ${step.description} ${step.whileItRuns}`.toLowerCase();
    const needle = this.normalizeIngredient(name);
    if (!needle) return false;
    if (hay.includes(needle)) return true;
    return needle.split(' ').filter(word => word.length > 3).some(word => hay.includes(word));
  }

  private reviewStorageKey(): string {
    return brewReviewKey(this.recipeKey());
  }

  private progressStorageKey(): string {
    return brewProgressKey(this.recipeKey());
  }

  private reviewLegacyKey(): string | null {
    return this.keepsPersonalRecipe() ? legacyBrewReviewKey(this.recipeKey()) : null;
  }

  private progressLegacyKey(): string | null {
    return this.keepsPersonalRecipe() ? legacyBrewProgressKey(this.recipeKey()) : null;
  }

  private persistProgress(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.keepsPersonalRecipe()) {
      this.clearProgress();
      return;
    }
    if (this.savedToServer || this.discardProgress) return;
    const progress = {
      startedAt: this.sessionStartedAt.toISOString(),
      elapsed: this.elapsed,
      stepIndex: this.stepIndex,
      completedUntil: this.completedUntil,
      timerLeft: this.currentRemainingMs() / 1000,
      timerTotal: this.timerTotal,
      reviewOpen: this.keepsPersonalRecipe() ? this.reviewOpen : false,
      rating: this.keepsPersonalRecipe() ? this.rating : 4,
      intensity: this.keepsPersonalRecipe() ? this.intensity : 4,
      adjustRecipe: this.keepsPersonalRecipe() ? this.adjustRecipe : false,
      reviewNote: this.keepsPersonalRecipe() ? this.reviewNote : '',
      reviewRows: this.keepsPersonalRecipe() ? this.reviewRows : [],
      pantrySelections: this.keepsPersonalRecipe()
        ? [...this.pantrySelection.entries()].map(([name, id]) => ({ name, id }))
        : [],
    };
    localStorage.setItem(this.progressStorageKey(), JSON.stringify(progress));
    if (this.progressLegacyKey()) localStorage.removeItem(this.progressLegacyKey() as string);
  }

  private clearProgress(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    removeScopedItem(this.progressStorageKey(), this.progressLegacyKey());
  }

  private restoreProgress(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.keepsPersonalRecipe()) {
      this.clearProgress();
      return;
    }
    try {
      const raw = readScopedItem(this.progressStorageKey(), this.progressLegacyKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        startedAt: string;
        elapsed: number;
        stepIndex: number;
        completedUntil: number;
        timerLeft: number;
        timerTotal: number;
        reviewOpen: boolean;
        rating: number;
        intensity: number;
        adjustRecipe: boolean;
        reviewNote: string;
        reviewRows: ReviewRow[];
        pantrySelections: { name: string; id: string }[];
      }>;
      const started = new Date(parsed.startedAt ?? '');
      if (!Number.isNaN(started.getTime())) this.sessionStartedAt = started;
      const elapsed = Number(parsed.elapsed);
      if (Number.isFinite(elapsed) && elapsed >= 0) this.elapsed = Math.round(elapsed);
      const stepIndex = Number(parsed.stepIndex);
      if (Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < this.steps.length) {
        this.stepIndex = stepIndex;
      }
      const completedUntil = Number(parsed.completedUntil);
      if (Number.isInteger(completedUntil) && completedUntil >= 0) {
        this.completedUntil = Math.min(completedUntil, this.steps.length);
      }
      const timerLeft = Number(parsed.timerLeft);
      const timerTotal = Number(parsed.timerTotal);
      if (Number.isFinite(timerLeft) && timerLeft >= 0) {
        this.restoredTimerLeft = timerLeft;
        this.restoredTimerTotal = Number.isFinite(timerTotal) && timerTotal >= 0
          ? Math.round(timerTotal)
          : Math.ceil(timerLeft);
      }
      if (this.keepsPersonalRecipe()) {
        if (typeof parsed.adjustRecipe === 'boolean') this.adjustRecipe = parsed.adjustRecipe;
        if (typeof parsed.reviewNote === 'string') this.reviewNote = parsed.reviewNote;
        if (parsed.rating) this.rating = this.clampScore(parsed.rating);
        if (parsed.intensity) this.intensity = this.clampScore(parsed.intensity);
      }
      if (this.keepsPersonalRecipe() && Array.isArray(parsed.reviewRows)) {
        const rows = parsed.reviewRows.flatMap(row => {
          const ingredientIndex = Number(row?.ingredientIndex);
          const amount = Number(row?.amount);
          const id = Number(row?.id);
          if (!Number.isInteger(ingredientIndex) || ingredientIndex < 0 || ingredientIndex >= this.recipe.ingredients.length) return [];
          if (!Number.isFinite(amount) || !Number.isInteger(id)) return [];
          const powderGrams = this.readPowder(row?.powderGrams);
          return [{
            id,
            ingredientIndex,
            amount,
            powderGrams,
            powderFollowsAmount: powderGrams == null ? true : row?.powderFollowsAmount !== false,
          }];
        });
        if (rows.length) {
          this.reviewRows = rows.map(row => {
            if (!this.tracksPowder(row.ingredientIndex) || row.powderGrams != null) return row;
            return {
              ...row,
              powderGrams: this.derivedPowder(row.amount, this.unitOf(row)),
              powderFollowsAmount: true,
            };
          });
          this.nextReviewRowId = Math.max(...rows.map(row => row.id)) + 1;
        }
      }
      if (this.keepsPersonalRecipe() && Array.isArray(parsed.pantrySelections)) {
        for (const row of parsed.pantrySelections) {
          if (typeof row?.name === 'string' && typeof row?.id === 'string' && row.id) {
            this.pantrySelection.set(row.name, row.id);
          }
        }
      }
      if (this.keepsPersonalRecipe()) this.reviewOpen = !!parsed.reviewOpen;
    } catch {
      this.clearProgress();
    }
  }

  private buildReview(): SavedBrewReview {
    const previous = this.savedReview;
    const kept = previous?.adjustRecipe ? previous.adjustments : this.coverageAdjustments();
    const keepPrevious = !this.adjustRecipe && kept.length > 0;
    const adjustments = this.adjustRecipe
      ? this.reviewRows.map(row => {
          const ingredient = this.recipe.ingredients[row.ingredientIndex];
          return {
            name: ingredient?.name ?? '',
            unit: ingredient?.unit ?? '',
            amount: row.amount,
            original: this.originalAmount(row.ingredientIndex),
            powderGrams: this.showsPowder(row) ? row.powderGrams : null,
          };
        })
      : keepPrevious
        ? kept
        : [];
    return {
      rating: this.clampScore(this.rating),
      intensity: this.clampScore(this.intensity),
      adjustRecipe: this.adjustRecipe || keepPrevious,
      note: this.adjustRecipe ? this.reviewNote.trim() : (keepPrevious && previous ? previous.note : ''),
      adjustments,
      savedAt: new Date().toISOString(),
      bannerHidden: keepPrevious && previous ? !!previous.bannerHidden : false,
      recordAdjustments: this.adjustRecipe,
    };
  }

  private resumePendingSave(): void {
    if (!this.auth.isAuthenticated() || this.saving) return;
    const resume = this.authPrompt.peek();
    if (!resume || resume.action !== 'save-brew' || !this.recipeKeys().includes(resume.slug)) return;
    const review = this.readStashedReview() ?? (this.reviewOpen ? this.buildReview() : null);
    if (!review) {
      this.authPrompt.clearResume('save-brew');
      queueMicrotask(() => this.exit());
      return;
    }
    void this.commitReview(review, { returnToRecipe: true });
  }

  private async commitReview(review: SavedBrewReview, options?: { returnToRecipe?: boolean }): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.authPrompt.clearResume('save-brew');
    this.awaitingAuth = false;
    this.pendingReview = null;
    this.saveError = '';
    this.cdr.markForCheck();
    const brewedAt = new Date();
    try {
      const saved = await this.brewSessions.create({
        recipe_id: this.recipe.recipe_id,
        feedback: {
          flavor_intensity: review.intensity,
          note: review.recordAdjustments ? review.note : '',
          rating: review.rating,
        },
        brewed_at: brewedAt.toISOString(),
        started_at: this.sessionStartedAt.toISOString(),
        duration_seconds: Math.max(0, Math.round(this.elapsed)),
        ingredient_adjustments: this.adjustmentPayload(review),
        pantry_selections: this.pantryChoices
          .filter(choice => choice.selectedId)
          .map(choice => ({
            ingredient_name: choice.name,
            pantry_item_id: choice.selectedId,
          })),
        ingredients_used: this.ingredientsUsed(review),
        result_image: null,
        shared_post_id: null,
      });
      this.persistReview(review);
      this.clearProgress();
      this.clearStashedReview();
      this.savedToServer = true;
      this.savedCoverage = saved.coverage ?? null;
      if (this.destroyed) return;
      this.zone.run(() => {
        if (this.destroyed) return;
        if (options?.returnToRecipe) {
          this.toast.success('Brew saved');
          this.exit();
          return;
        }
        this.brewSaved.emit(this.savedCoverage);
        this.savedOpen = true;
        this.reviewOpen = false;
        this.cdr.detectChanges();
      });
    } catch (error: unknown) {
      const message = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string'
        ? error.error
        : 'Could not save your brew. Please try again.';
      if (!this.destroyed) {
        this.saveError = message;
        this.toast.error(message);
      }
    } finally {
      this.saving = false;
      if (!this.destroyed) this.cdr.markForCheck();
    }
  }

  private clampScore(value: number): number {
    const score = Math.round(Number(value));
    if (!Number.isFinite(score)) return 1;
    return Math.min(5, Math.max(1, score));
  }

  private readSavedReview(): SavedBrewReview | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      if (!this.keepsPersonalRecipe()) return null;
      const raw = readScopedItem(this.reviewStorageKey(), this.reviewLegacyKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SavedBrewReview>;
      const adjustments = Array.isArray(parsed.adjustments)
        ? parsed.adjustments.flatMap(item => {
            if (!item || typeof item.name !== 'string') return [];
            const amount = Number(item.amount);
            const original = Number(item.original);
            if (!Number.isFinite(amount) || !Number.isFinite(original)) return [];
            return [{
              name: item.name,
              unit: typeof item.unit === 'string' ? item.unit : '',
              amount,
              original,
              powderGrams: this.readPowder(item.powderGrams),
            }];
          })
        : [];
      return {
        rating: Number(parsed.rating) || 0,
        intensity: Number(parsed.intensity) || 0,
        adjustRecipe: !!parsed.adjustRecipe,
        note: typeof parsed.note === 'string' ? parsed.note : '',
        adjustments,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
        bannerHidden: !!parsed.bannerHidden,
      };
    } catch {
      return null;
    }
  }

  private persistReview(review: SavedBrewReview): void {
    this.savedReview = review;
    if (!isPlatformBrowser(this.platformId) || !this.keepsPersonalRecipe()) return;
    writeScopedItem(this.reviewStorageKey(), this.reviewLegacyKey(), JSON.stringify(review));
  }

  private formatMeasure(amount: number, unit: string): string {
    const value = this.formatAmount(amount);
    const normalized = (unit || '').trim();
    if (!normalized) return value;
    if (this.compactUnits.includes(normalized.toLowerCase())) return `${value}${normalized}`;
    return `${value} ${normalized}`;
  }

  private roundAmount(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private persistTimer(): void {
    if (!this.step?.timerSeconds) return;
    this.captureRemaining();
    this.timerMemory.set(this.stepIndex, { leftMs: this.remainingMs, total: this.timerTotal });
  }

  private restoreTimer(): void {
    const seconds = this.step?.timerSeconds ?? 0;
    const saved = this.timerMemory.get(this.stepIndex);
    if (this.restoredTimerLeft != null) {
      const savedLeft = this.restoredTimerLeft;
      const savedTotal = this.restoredTimerTotal ?? seconds;
      this.restoredTimerLeft = null;
      this.restoredTimerTotal = null;
      if (seconds > 0 && savedLeft <= 0 && savedTotal <= 0) {
        this.remainingMs = seconds * 1000;
        this.timerTotal = seconds;
      } else {
        this.remainingMs = Math.max(0, savedLeft) * 1000;
        this.timerTotal = savedTotal > 0 ? savedTotal : seconds;
      }
    } else if (saved) {
      this.remainingMs = saved.leftMs;
      this.timerTotal = saved.total;
    } else {
      this.remainingMs = seconds * 1000;
      this.timerTotal = seconds;
    }
    this.timerLeft = this.secondsLeft(this.remainingMs);
    this.timerRunning = false;
    this.snapRing(this.remainingMs, null);
  }

  private captureRemaining(): void {
    if (!this.timerRunning) return;
    this.remainingMs = Math.max(0, this.timerEndsAt - Date.now());
    this.timerLeft = this.secondsLeft(this.remainingMs);
  }

  private currentRemainingMs(): number {
    if (this.timerRunning) return Math.max(0, this.timerEndsAt - Date.now());
    return Math.max(0, this.remainingMs);
  }

  private secondsLeft(ms: number): number {
    if (ms <= 0) return 0;
    return Math.ceil(ms / 1000 - 1e-6);
  }

  private pauseTimer(): void {
    this.captureRemaining();
    this.timerRunning = false;
    this.clearClock();
    this.snapRing(this.remainingMs, null);
  }

  private finishTimer(): void {
    this.remainingMs = 0;
    this.timerLeft = 0;
    this.timerRunning = false;
    this.clearClock();
    this.snapRing(0, null);
    this.persistProgress();
    if (this.voiceOn) this.speak('Time is up. Confirm when you are ready.');
  }

  private ringOffsetFor(ms: number): number {
    if (!this.timerTotal) return 0;
    const ratio = Math.min(1, Math.max(0, ms) / (this.timerTotal * 1000));
    return this.circumference * (1 - ratio);
  }

  private snapRing(ms: number, animateMs: number | null): void {
    const token = ++this.ringToken;
    this.ringTransition = 'none';
    this.ringOffset = this.ringOffsetFor(ms);
    if (animateMs == null || animateMs <= 0 || !isPlatformBrowser(this.platformId)) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (token !== this.ringToken || this.destroyed || !this.timerRunning) return;
        this.ringTransition = `stroke-dashoffset ${Math.max(0, Math.round(animateMs))}ms linear`;
        this.ringOffset = this.circumference;
        this.cdr.markForCheck();
      });
    });
  }

  private nextClockDelay(ms: number): number {
    if (ms <= 0) return 0;
    const boundary = Math.max(0, (this.secondsLeft(ms) - 1) * 1000);
    return Math.max(16, ms - boundary);
  }

  private armClock(): void {
    this.clearClock();
    if (!isPlatformBrowser(this.platformId)) return;
    const tick = () => {
      this.clockHandle = null;
      if (!this.timerRunning || this.destroyed) return;
      const ms = Math.max(0, this.timerEndsAt - Date.now());
      this.zone.run(() => {
        if (!this.timerRunning || this.destroyed) return;
        if (ms <= 0) {
          this.finishTimer();
          this.cdr.markForCheck();
          return;
        }
        const next = this.secondsLeft(ms);
        if (next !== this.timerLeft) this.timerLeft = next;
        this.cdr.markForCheck();
      });
      if (!this.timerRunning || this.destroyed) return;
      this.clockHandle = window.setTimeout(tick, this.nextClockDelay(this.currentRemainingMs()));
    };
    this.clockHandle = window.setTimeout(tick, this.nextClockDelay(this.currentRemainingMs()));
  }

  private clearClock(): void {
    if (this.clockHandle == null) return;
    window.clearTimeout(this.clockHandle);
    this.clockHandle = null;
  }

  private speak(text: string): void {
    if (!isPlatformBrowser(this.platformId) || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }
}
