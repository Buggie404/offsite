import { ChangeDetectorRef, Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideChevronDown,
  LucideEye,
  LucideEyeOff,
  LucideGripVertical,
  LucideClock,
  LucideImage,
  LucidePlus,
  LucideSearch,
  LucideTrash2,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';
import { CloudinaryService } from '../../../../features/community/services/cloudinary.service';
import {
  AdminModerationStatus,
  AdminRecipeDetail,
  AdminRecipeFeatureDraft,
  AdminRecipeRow,
  AdminRecipeService,
  AdminRecipeSource,
  FeaturedSlot,
  LinkableProduct
} from '../../services/admin-recipe.service';
import {
  NOTE_MAX,
  RecipeModerationReason,
  notePlaceholder,
  noteRequired,
  reasonsFor
} from '../../constants/recipe-moderation-reasons';

type ActionKind = 'hide' | 'show' | 'delete' | 'changes' | 'reject';
type DragList = 'ingredients' | 'tools' | 'steps';

interface IngredientRow {
  key: number;
  name: string;
  quantity: string;
  unit: string;
}

interface ToolRow {
  key: number;
  name: string;
}

interface StepRow {
  key: number;
  title: string;
  description: string;
  minutes: string;
  seconds: string;
  timerOpen: boolean;
}

interface Snapshot {
  title: string;
  description: string;
  base: string;
  serves: string[];
  difficulty: string;
  servings: string;
  prepTime: string;
  ingredients: { name: string; quantity: string; unit: string }[];
  tools: { name: string }[];
  steps: { title: string; description: string; minutes: string; seconds: string }[];
  published: boolean;
  featured: boolean;
  replaceId: string;
  linkedIds: string[];
}

interface RitualLine {
  name: string;
  amount: string;
  status: 'linked' | 'suggested' | 'none';
  product: LinkableProduct | null;
}

const SUGGESTION_STOP = new Set([
  'and', 'the', 'for', 'from', 'with', 'into', 'per', 'hot', 'cold', 'warm', 'iced',
  'ice', 'ices', 'cube', 'cubes', 'water', 'sugar', 'salt', 'honey', 'syrup',
  'shot', 'shots', 'cup', 'cups', 'tsp', 'tbsp', 'pinch', 'dash', 'splash', 'fresh'
]);
const TOKEN_ALIASES: Record<string, string[]> = {
  espresso: ['coffee'],
  coffee: ['espresso'],
  bean: ['coffee', 'beans'],
  beans: ['coffee', 'bean'],
  brew: ['coffee'],
  whisk: ['chasen'],
  chasen: ['whisk'],
  bowl: ['chawan'],
  chawan: ['bowl'],
  kettle: ['gooseneck'],
  gooseneck: ['kettle'],
  oat: ['oatly'],
  oatly: ['oat'],
  dripper: ['pourover', 'v60'],
  pourover: ['dripper', 'v60'],
  v60: ['dripper', 'pourover']
};
const GENERIC_TOKENS = new Set([
  'powder', 'grade', 'organic', 'premium', 'classic', 'blend', 'house', 'drink',
  'set', 'kit', 'natural', 'pure', 'style', 'extra', 'dark', 'light',
  'medium', 'fine', 'white', 'black', 'original', 'signature', 'special',
  'cream', 'foam', 'sauce', 'oil', 'juice', 'yogurt'
]);
const HEAD_NOUNS = new Set(['milk', 'tea', 'syrup', 'beans', 'bean', 'powder']);
const QUANTITY_PART = String.raw`(?:\d+\s+)?(?:\d+\/\d+|\d+(?:\.\d+)?|\.\d+)`;
const QUANTITY_PATTERN = new RegExp(`^${QUANTITY_PART}(?:\\s*-\\s*${QUANTITY_PART})?$`);

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function meaningfulTokens(value: string): string[] {
  return normalizeName(value).split(' ').filter((token) => token.length > 2 && !/^\d/.test(token) && !SUGGESTION_STOP.has(token));
}

function stem(token: string): string {
  let value = token;
  if (value.length > 4 && value.endsWith('ies')) value = `${value.slice(0, -3)}y`;
  else if (value.length > 4 && value.endsWith('es') && !/(ss|ch|sh)es$/.test(value)) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss')) value = value.slice(0, -1);
  return value.length >= 3 ? value : token;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const next = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = stem(a);
  const right = stem(b);
  if (left === right) return 0.94;
  const aliases = new Set([...(TOKEN_ALIASES[a] || []), ...(TOKEN_ALIASES[left] || [])].map(stem));
  if (aliases.has(b) || aliases.has(right)) return 0.82;
  const longer = Math.max(left.length, right.length);
  if (longer >= 5 && editDistance(left, right) <= (longer >= 8 ? 2 : 1)) return 0.72;
  return 0;
}

function hintMatchTokens(hint: string): string[] {
  const all = meaningfulTokens(hint);
  const distinctive = all.filter((token) => !GENERIC_TOKENS.has(token) && !GENERIC_TOKENS.has(stem(token))
    && !HEAD_NOUNS.has(token) && !HEAD_NOUNS.has(stem(token)));
  if (distinctive.length) return distinctive;
  return all.filter((token) => !GENERIC_TOKENS.has(token) || HEAD_NOUNS.has(token) || HEAD_NOUNS.has(stem(token)));
}

function namesMatch(hint: string, productName: string): boolean {
  const hintTokens = hintMatchTokens(hint);
  const productTokens = meaningfulTokens(productName);
  if (!hintTokens.length || !productTokens.length) return false;
  const hintNorm = normalizeName(hint);
  const productNorm = normalizeName(productName);
  if (hintNorm.length >= 3 && (productNorm.includes(hintNorm) || hintNorm.includes(productNorm))) return true;
  const hintCompact = hintTokens.join('');
  if (hintCompact.length >= 4 && productTokens.join('').includes(hintCompact)) return true;
  let hits = 0;
  for (const token of hintTokens) {
    const best = productTokens.reduce((max, other) => Math.max(max, tokenSimilarity(token, other)), 0);
    if (best >= 0.68) hits += 1;
  }
  if (!hits) return false;
  if (hintTokens.length === 1) return true;
  return hits * 2 >= hintTokens.length;
}

function isValidQuantity(value: string): boolean {
  const text = value.trim().replace(/,/g, '.').replace(/[–—]/g, '-');
  if (!text) return true;
  return QUANTITY_PATTERN.test(text);
}

function normalizeQuantity(value: string): string | number | null {
  const text = value.trim().replace(/,/g, '.').replace(/[–—]/g, '-');
  if (!text) return null;
  const normalized = text.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  if (/^\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  return normalized;
}

@Component({
  selector: 'app-admin-recipe-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideArrowLeft,
    LucideClock,
    LucideImage,
    LucidePlus,
    LucideTrash2,
    LucideChevronDown,
    LucideGripVertical,
    LucideEye,
    LucideEyeOff,
    LucideX,
    LucideSearch,
    LucideCheck,
    LucideTriangleAlert
  ],
  templateUrl: './recipe-detail.component.html',
  styleUrl: './recipe-detail.component.scss'
})
export class AdminRecipeDetailComponent implements OnInit {
  private recipesApi = inject(AdminRecipeService);
  private cloudinary = inject(CloudinaryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);

  readonly baseOptions = [
    { value: 'matcha', label: 'Matcha' },
    { value: 'coffee', label: 'Coffee' },
    { value: 'others', label: 'Others' }
  ];
  readonly serveOptions = [
    { value: 'hot', label: 'Hot' },
    { value: 'cold', label: 'Cold' },
    { value: 'dessert', label: 'Dessert' }
  ];
  readonly difficulties = [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' }
  ];
  readonly units = ['g', 'ml', 'cup', 'tsp', 'tbsp', 'oz', 'piece', 'pinch'];
  readonly noteMax = NOTE_MAX;

  loading = true;
  creating = false;
  saving = false;
  error = '';
  loadError = '';
  recipeId = '';
  source: AdminRecipeSource = 'offsite';
  authorLine = '';
  published = true;
  canEditContent = true;
  moderationStatus: AdminModerationStatus | null = null;
  reviewRound = 0;
  maxReviewRounds = 3;
  updatedAt: string | null = null;
  canLink = true;
  featuredSlots: FeaturedSlot[] = [];
  featuredLimit = 10;
  replaceId = '';
  imageUrl: string | null = null;
  hero: { url: string; public_id: string } | null = null;
  coverPreview: string | null = null;
  suggestions: LinkableProduct[] = [];
  linkedIds: string[] = [];

  title = '';
  description = '';
  base = '';
  serves: string[] = [];
  serveOpen = false;
  difficulty = '';
  servings = '1';
  prepTime = '0';
  featured = false;
  ingredients: IngredientRow[] = [];
  tools: ToolRow[] = [];
  steps: StepRow[] = [];

  productModal = false;
  productQuery = '';
  productSearching = false;
  searchResults: LinkableProduct[] = [];
  pendingIds: string[] = [];

  leavePrompt = false;
  action: ActionKind | null = null;
  actionError = '';
  savingAction = false;
  note = '';
  reason = '';

  private saved: Snapshot | null = null;
  private allowLeave = false;
  private leavePromise: Promise<boolean> | null = null;
  private leaveResolve: ((allow: boolean) => void) | null = null;
  private coverFile: File | null = null;
  private nextKey = 1;
  private request = 0;
  private suggestionKey = '';
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private productMap = new Map<string, LinkableProduct>();
  private drag: { list: DragList; index: number } | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.revokePreview();
      if (this.suggestTimer) clearTimeout(this.suggestTimer);
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('recipeId');
      if (!id) this.startNew();
      else this.load(id);
    });
  }

  get ownerHandle(): string {
    const name = this.authorLine.replace(/^@/, '').trim();
    return name ? `@${name}` : '';
  }

  get heading(): string {
    const title = this.title.trim();
    if (title) return title;
    return this.creating ? 'New Offsite recipe' : 'Untitled recipe';
  }

  get metaNote(): string {
    const parts: string[] = [];
    if (this.source === 'community') {
      parts.push(this.authorLine ? `by @${this.authorLine.replace(/^@/, '')}` : 'by Community');
    }
    if (this.updatedAt) {
      const updated = this.dateLabel(this.updatedAt);
      if (updated) parts.push(`updated ${updated}`);
    }
    return parts.join(' · ');
  }

  get visibilityNote(): string {
    if (this.creating) return this.published ? 'Published when you save.' : 'Hidden when you save.';
    if (this.awaitingReview) {
      return `Resubmitted by the owner · review ${Math.min(this.reviewRound, this.maxReviewRounds)} of ${this.maxReviewRounds}`;
    }
    if (this.moderationStatus === 'hidden_final') return 'Hidden after final review';
    return this.published ? 'Shown on Recipes page' : 'Hidden from the Recipes page';
  }

  get awaitingReview(): boolean {
    return !this.creating && this.source === 'community' && this.moderationStatus === 'resubmitted';
  }

  get canRequestChanges(): boolean {
    return this.awaitingReview && this.reviewRound < this.maxReviewRounds;
  }

  get canFinalReject(): boolean {
    return this.awaitingReview && this.reviewRound >= this.maxReviewRounds;
  }

  get visibilityLabel(): string {
    if (this.published) return 'Hide';
    return this.awaitingReview ? 'Restore' : 'Show';
  }

  onVisibility(): void {
    if (this.savingAction) return;
    if (this.creating) {
      this.published = !this.published;
      if (!this.published) {
        this.featured = false;
        this.replaceId = '';
      }
      return;
    }
    this.openAction(this.published ? 'hide' : 'show');
  }

  get needsReplacement(): boolean {
    const alreadyFeatured = Boolean(this.saved?.featured);
    return this.published && this.featured && !alreadyFeatured && this.featuredSlots.length >= this.featuredLimit;
  }

  get featureNote(): string {
    if (!this.published) return 'Hidden recipes stay off the homepage.';
    const filled = Math.min(this.featuredLimit, this.featuredSlots.length + (this.saved?.featured ? 1 : 0));
    if (this.saved?.featured && this.featured) return `On the homepage · ${filled} of ${this.featuredLimit}.`;
    if (this.featuredSlots.length >= this.featuredLimit) {
      return this.featured
        ? 'Homepage is full. Choose which recipe this one replaces.'
        : `Homepage is full (${this.featuredLimit}). Turn this on, then choose which recipe to replace.`;
    }
    const open = this.featuredLimit - this.featuredSlots.length;
    return this.featured
      ? `Adds this recipe to the homepage. ${open} spot${open === 1 ? '' : 's'} left.`
      : `${filled} of ${this.featuredLimit} homepage spots filled.`;
  }

  toggleFeatured(): void {
    if (!this.published || this.saving) return;
    this.featured = !this.featured;
    if (!this.featured) this.replaceId = '';
  }

  get coverSrc(): string | null {
    return this.coverPreview || this.hero?.url || this.imageUrl;
  }

  get serveSummary(): string {
    const labels = this.serveOptions.filter((item) => this.serves.includes(item.value)).map((item) => item.label);
    return labels.length ? labels.join(', ') : 'Select';
  }

  get dirty(): boolean {
    if (!this.saved) return false;
    return !!this.coverFile || JSON.stringify(this.snapshot()) !== JSON.stringify(this.saved);
  }

  get changeSummary(): string {
    if (!this.saved) return 'details';
    const next = this.snapshot();
    const parts: string[] = [];
    if (this.coverFile) parts.push('cover image');
    if (next.title !== this.saved.title) parts.push('title');
    if (next.description !== this.saved.description) parts.push('description');
    if (
      next.base !== this.saved.base
      || next.serves.join('|') !== this.saved.serves.join('|')
      || next.difficulty !== this.saved.difficulty
      || next.servings !== this.saved.servings
      || next.prepTime !== this.saved.prepTime
    ) {
      parts.push('details');
    }
    if (JSON.stringify(next.ingredients) !== JSON.stringify(this.saved.ingredients)) parts.push('ingredients');
    if (JSON.stringify(next.tools) !== JSON.stringify(this.saved.tools)) parts.push('tools');
    if (JSON.stringify(next.steps) !== JSON.stringify(this.saved.steps)) parts.push('steps');
    if (next.published !== this.saved.published) parts.push('visibility');
    if (next.featured !== this.saved.featured) parts.push('featured');
    if (next.replaceId !== this.saved.replaceId) parts.push('homepage replacement');
    if (next.linkedIds.join('|') !== this.saved.linkedIds.join('|')) parts.push('linked products');
    return parts.join(', ') || 'details';
  }

  get ritualLines(): RitualLine[] {
    const items = [
      ...this.ingredients
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim(), amount: this.amount(item.quantity, item.unit) })),
      ...this.tools
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim(), amount: '' }))
    ];
    return items.map((item) => {
      const linked = this.linkedProducts.find((product) => namesMatch(item.name, product.name));
      if (linked) return { ...item, status: 'linked', product: linked };
      const suggested = this.suggestions.find((product) =>
        product.matched_hint === item.name && !this.linkedIds.includes(product.product_id)
      );
      if (suggested) return { ...item, status: 'suggested', product: suggested };
      return { ...item, status: 'none', product: null };
    });
  }

  get linkedProducts(): LinkableProduct[] {
    return this.linkedIds.map((id) => this.productMap.get(id) || {
      product_id: id,
      name: `Product ${id}`,
      sku: '',
      image_url: null,
      in_stock: true
    });
  }

  get modalRows(): LinkableProduct[] {
    const source = this.productQuery.trim() ? this.searchResults : this.suggestions;
    const seen = new Set<string>();
    return source.filter((product) => {
      if (this.linkedIds.includes(product.product_id) || seen.has(product.product_id)) return false;
      seen.add(product.product_id);
      return true;
    });
  }

  get selectedTotal(): number {
    return this.linkedIds.length + this.pendingIds.length;
  }

  get selectionNote(): string {
    const names = this.linkedProducts.map((product) => product.name).filter(Boolean);
    const included = names.length ? ` (incl. ${names.join(', ')})` : '';
    return `Selected ${this.selectedTotal} of 3${included}. Out-of-stock products can be linked but show “Sold out” on the recipe.`;
  }

  get addLabel(): string {
    const count = this.pendingIds.length;
    if (this.saving) return 'Saving…';
    if (!count) return 'Add products';
    return `Add ${count} product${count === 1 ? '' : 's'}`;
  }

  get atProductCap(): boolean {
    return this.selectedTotal >= 3;
  }

  get ingredientCount(): number {
    return this.ingredients.length;
  }

  get toolCount(): number {
    return this.tools.length;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  get dangerAction(): boolean {
    return this.action === 'delete' || this.action === 'reject';
  }

  get reasonOptions(): RecipeModerationReason[] {
    if (this.action !== 'hide' && this.action !== 'delete') return [];
    return reasonsFor(this.action, this.source);
  }

  get noteNeedsValue(): boolean {
    return noteRequired(this.reason);
  }

  get noteFieldPlaceholder(): string {
    if (this.source === 'community') {
      if (this.reason === 'low_quality') {
        return 'Say what needs fixing — this is sent to the owner';
      }
      return this.noteNeedsValue
        ? 'Required note — sent to the owner'
        : 'Optional note — sent to the owner with the reason';
    }
    return notePlaceholder(this.reason);
  }

  get actionTitle(): string {
    const title = this.heading;
    if (this.action === 'hide') return `Hide “${title}”?`;
    if (this.action === 'show') {
      return this.awaitingReview ? `Restore “${title}” to the Recipes page?` : `Show “${title}” on the Recipes page?`;
    }
    if (this.action === 'changes') return `Request more changes on “${title}”?`;
    if (this.action === 'reject') return `Final reject “${title}”?`;
    return `Delete “${title}”?`;
  }

  get confirmLabel(): string {
    if (this.savingAction) return 'Saving…';
    if (this.action === 'hide') {
      return this.source === 'community' ? 'Hide & notify' : 'Hide recipe';
    }
    if (this.action === 'show') return this.awaitingReview ? 'Restore recipe' : 'Show recipe';
    if (this.action === 'changes') return 'Request changes';
    if (this.action === 'reject') return 'Final reject';
    return this.source === 'community' ? 'Delete & notify' : 'Delete recipe';
  }

  get canConfirm(): boolean {
    if (!this.action || this.savingAction) return false;
    if (this.action === 'show') return true;
    if (this.action === 'changes') return !!this.note.trim() && this.note.trim().length <= this.noteMax;
    if (this.action === 'reject') return this.note.trim().length <= this.noteMax;
    if (!this.reasonOptions.some((item) => item.value === this.reason)) return false;
    if (this.noteNeedsValue && !this.note.trim()) return false;
    return this.note.trim().length <= this.noteMax;
  }

  countLabel(count: number, noun: 'item' | 'step'): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  productMeta(product: LinkableProduct): string {
    if (!product.in_stock) return 'out of stock';
    if (product.matched_hint) return `Matches “${product.matched_hint}” · in stock`;
    if (product.sku) return `${product.sku} · in stock`;
    return 'in stock';
  }

  isPending(product: LinkableProduct): boolean {
    return this.pendingIds.includes(product.product_id);
  }

  addIngredient(): void {
    this.ingredients = [...this.ingredients, this.blankIngredient()];
  }

  addTool(): void {
    this.tools = [...this.tools, this.blankTool()];
  }

  addStep(): void {
    this.steps = [...this.steps, this.blankStep()];
  }

  serveOn(value: string): boolean {
    return this.serves.includes(value);
  }

  toggleServe(value: string): void {
    const next = this.serveOn(value)
      ? this.serves.filter((item) => item !== value)
      : [...this.serves, value];
    this.serves = this.serveOptions.map((item) => item.value).filter((item) => next.includes(item));
  }

  openTimer(step: StepRow): void {
    step.timerOpen = true;
  }

  clearTimer(step: StepRow): void {
    step.minutes = '';
    step.seconds = '';
    step.timerOpen = false;
  }

  removeIngredient(index: number): void {
    this.ingredients = this.ingredients.filter((_, itemIndex) => itemIndex !== index);
  }

  removeTool(index: number): void {
    this.tools = this.tools.filter((_, itemIndex) => itemIndex !== index);
  }

  removeStep(index: number): void {
    this.steps = this.steps.filter((_, itemIndex) => itemIndex !== index);
  }

  onNameInput(): void {
    const key = this.hintNames().join('\n');
    if (key === this.suggestionKey) return;
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = setTimeout(() => this.fetchSuggestions(key), 250);
  }

  onCover(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error = 'Cover must be an image.';
      return;
    }
    this.error = '';
    this.revokePreview();
    this.coverFile = file;
    this.coverPreview = URL.createObjectURL(file);
  }

  linkProduct(product: LinkableProduct): void {
    if (!this.canLink || this.linkedIds.includes(product.product_id) || this.linkedIds.length >= 3) return;
    this.remember(product);
    this.linkedIds = [...this.linkedIds, product.product_id];
  }

  unlink(productId: string): void {
    this.linkedIds = this.linkedIds.filter((id) => id !== productId);
  }

  openProducts(): void {
    if (!this.canLink) return;
    this.productModal = true;
    this.productQuery = '';
    this.pendingIds = [];
    this.searchResults = [];
    this.productSearching = false;
  }

  onProductSearch(value: string): void {
    this.productQuery = value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.searchResults = [];
      this.productSearching = false;
      return;
    }
    this.productSearching = true;
    this.searchTimer = setTimeout(() => {
      this.recipesApi.searchProducts(value).subscribe({
        next: (response) => {
          this.searchResults = response.data || [];
          this.searchResults.forEach((product) => this.remember(product));
          this.productSearching = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.productSearching = false;
          this.searchResults = [];
          this.cdr.markForCheck();
        }
      });
    }, 200);
  }

  togglePending(product: LinkableProduct): void {
    if (this.linkedIds.includes(product.product_id)) return;
    if (this.pendingIds.includes(product.product_id)) {
      this.pendingIds = this.pendingIds.filter((id) => id !== product.product_id);
      return;
    }
    if (this.atProductCap) return;
    this.remember(product);
    this.pendingIds = [...this.pendingIds, product.product_id];
  }

  confirmProducts(): void {
    if (!this.pendingIds.length) return;
    const next = [...this.linkedIds];
    for (const id of this.pendingIds) {
      if (!next.includes(id) && next.length < 3) next.push(id);
    }
    this.linkedIds = next;
    this.closeProducts();
  }

  closeProducts(): void {
    this.productModal = false;
    this.pendingIds = [];
    this.productQuery = '';
  }

  discard(): void {
    if (!this.saved || this.saving) return;
    this.applySnapshot(this.saved);
    this.revokePreview();
    this.coverFile = null;
    this.error = '';
  }

  save(): void {
    if (this.saving || !this.dirty) return;
    const invalid = this.validate();
    if (invalid) {
      this.error = invalid;
      return;
    }
    this.saving = true;
    this.error = '';
    if (this.coverFile) {
      this.cloudinary.uploadFile(this.coverFile).subscribe({
        next: (uploaded) => this.persist({ url: uploaded.url, public_id: uploaded.public_id }),
        error: () => {
          this.saving = false;
          this.error = 'Could not upload the cover image.';
          this.cdr.markForCheck();
        }
      });
      return;
    }
    this.persist(this.hero);
  }

  openAction(kind: ActionKind): void {
    if (this.creating) return;
    this.action = kind;
    this.actionError = '';
    this.note = '';
    const options = kind === 'hide' || kind === 'delete' ? reasonsFor(kind, this.source) : [];
    this.reason = options[0]?.value || '';
  }

  onReasonChange(reason: string): void {
    this.reason = reason;
  }

  closeAction(): void {
    if (this.savingAction) return;
    this.action = null;
    this.actionError = '';
  }

  confirmAction(): void {
    if (!this.canConfirm || !this.action || !this.recipeId) return;
    this.savingAction = true;
    this.actionError = '';
    const note = this.note.trim();
    if (this.action === 'delete') {
      this.recipesApi.deleteRecipe(this.recipeId, { reason: this.reason, note }).subscribe({
        next: () => {
          this.allowLeave = true;
          void this.router.navigate(['/admin/recipes']);
        },
        error: (error) => this.failAction(error)
      });
      return;
    }
    if (this.action === 'changes' || this.action === 'reject') {
      const review = this.action === 'changes'
        ? this.recipesApi.requestChanges(this.recipeId, note)
        : this.recipesApi.finalReject(this.recipeId, note);
      review.subscribe({
        next: (response) => this.applyRow(response.data),
        error: (error) => this.failAction(error)
      });
      return;
    }
    const body = this.action === 'hide' ? { reason: this.reason, note } : {};
    this.recipesApi.setVisibility(this.recipeId, this.action === 'show', body).subscribe({
      next: (response) => this.applyRow(response.data),
      error: (error) => this.failAction(error)
    });
  }

  private applyRow(row: AdminRecipeRow): void {
    this.published = row.published;
    this.featured = row.featured;
    this.updatedAt = row.updated_at;
    this.moderationStatus = row.moderation_status ?? (row.published ? 'visible' : 'hidden');
    this.reviewRound = row.review_round ?? this.reviewRound;
    if (this.saved) {
      this.saved = { ...this.saved, published: row.published, featured: row.featured };
    }
    this.savingAction = false;
    this.action = null;
    this.cdr.markForCheck();
  }

  onDragStart(list: DragList, index: number, event: DragEvent): void {
    this.drag = { list, index };
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(list: DragList, index: number, event: DragEvent): void {
    event.preventDefault();
    if (!this.canEditContent) {
      this.drag = null;
      return;
    }
    if (!this.drag || this.drag.list !== list || this.drag.index === index) {
      this.drag = null;
      return;
    }
    const from = this.drag.index;
    this.drag = null;
    if (list === 'ingredients') this.moveRow(this.ingredients, from, index);
    else if (list === 'tools') this.moveRow(this.tools, from, index);
    else this.moveRow(this.steps, from, index);
    if (list !== 'steps') this.onNameInput();
  }

  private moveRow<T>(rows: T[], from: number, to: number): void {
    const [moved] = rows.splice(from, 1);
    if (moved === undefined) return;
    rows.splice(to, 0, moved);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.leavePrompt) this.stayOnPage();
    else if (this.productModal) this.closeProducts();
    else if (this.action && !this.savingAction) this.closeAction();
    else this.serveOpen = false;
  }

  @HostListener('document:click')
  closeServeMenu(): void {
    this.serveOpen = false;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty || this.allowLeave) return;
    event.preventDefault();
    event.returnValue = '';
  }

  confirmLeave(): boolean | Promise<boolean> {
    if (this.allowLeave || !this.dirty) return true;
    if (this.leavePromise) return this.leavePromise;
    this.leavePrompt = true;
    this.leavePromise = new Promise((resolve) => {
      this.leaveResolve = resolve;
    });
    this.cdr.detectChanges();
    return this.leavePromise;
  }

  stayOnPage(): void {
    this.finishLeave(false);
  }

  leavePage(): void {
    this.finishLeave(true);
  }

  private startNew(): void {
    this.request += 1;
    this.creating = true;
    this.loading = false;
    this.loadError = '';
    this.error = '';
    this.recipeId = '';
    this.source = 'offsite';
    this.authorLine = '';
    this.published = true;
    this.canEditContent = true;
    this.moderationStatus = null;
    this.reviewRound = 0;
    this.updatedAt = null;
    this.canLink = true;
    this.imageUrl = null;
    this.hero = null;
    this.suggestions = [];
    this.linkedIds = [];
    this.productMap.clear();
    this.revokePreview();
    this.coverFile = null;
    this.title = '';
    this.description = '';
    this.base = '';
    this.serves = [];
    this.serveOpen = false;
    this.difficulty = '';
    this.servings = '1';
    this.prepTime = '0';
    this.featured = false;
    this.replaceId = '';
    this.featuredSlots = [];
    this.ingredients = [this.blankIngredient()];
    this.tools = [this.blankTool()];
    this.steps = [this.blankStep()];
    this.saved = this.snapshot();
    this.suggestionKey = '';
    this.recipesApi.list().subscribe({
      next: (response) => {
        this.featuredSlots = response.featured_recipes || [];
        this.featuredLimit = response.featured_limit || 10;
        this.cdr.markForCheck();
      }
    });
    this.cdr.markForCheck();
  }

  private load(recipeId: string): void {
    const request = ++this.request;
    this.creating = false;
    this.loading = true;
    this.loadError = '';
    this.error = '';
    this.recipesApi.get(recipeId).subscribe({
      next: (response) => {
        if (request !== this.request) return;
        this.applyDetail(response.data);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (request !== this.request) return;
        this.loading = false;
        this.loadError = 'Could not load this recipe.';
        this.cdr.markForCheck();
      }
    });
  }

  private applyDetail(detail: AdminRecipeDetail): void {
    this.creating = false;
    this.recipeId = detail.recipe_id;
    this.source = detail.source;
    this.authorLine = detail.author_line || '';
    this.published = detail.published;
    this.canEditContent = detail.can_edit_content !== false;
    this.moderationStatus = detail.moderation_status ?? null;
    this.reviewRound = detail.review_round ?? 0;
    this.maxReviewRounds = detail.max_review_rounds ?? 3;
    this.updatedAt = detail.updated_at;
    this.canLink = detail.can_link_products;
    this.featuredSlots = detail.featured_recipes || [];
    this.featuredLimit = detail.featured_limit || 10;
    this.replaceId = '';
    this.imageUrl = detail.image_url;
    this.hero = detail.hero_image;
    this.title = detail.title || '';
    this.description = detail.description || '';
    this.base = detail.base || '';
    this.serves = this.orderedServes(detail.serves || []);
    this.serveOpen = false;
    this.difficulty = detail.difficulty || '';
    this.servings = String(detail.servings ?? 1);
    this.prepTime = String(detail.prepTime ?? 0);
    this.featured = detail.featured;
    this.ingredients = (detail.ingredients.length ? detail.ingredients : [{ name: '', quantity: null, unit: '' }])
      .map((item) => ({
        key: this.nextKey++,
        name: item.name || '',
        quantity: item.quantity == null ? '' : String(item.quantity),
        unit: item.unit || ''
      }));
    this.tools = (detail.tools.length ? detail.tools : [{ name: '', quantity: null }])
      .map((item) => ({
        key: this.nextKey++,
        name: item.name || ''
      }));
    this.steps = (detail.steps.length ? detail.steps : [{ title: '', description: '', timer_seconds: null }])
      .map((item) => this.stepFrom(item));
    this.productMap.clear();
    this.linkedIds = detail.linked_products.map((product) => product.product_id);
    detail.linked_products.forEach((product) => this.remember(product));
    this.suggestions = detail.suggestions || [];
    this.suggestions.forEach((product) => this.remember(product));
    this.revokePreview();
    this.coverFile = null;
    this.saved = this.snapshot();
    this.suggestionKey = this.hintNames().join('\n');
    this.error = '';
  }

  private persist(hero: { url: string; public_id: string } | null): void {
    const body = {
      title: this.title.trim(),
      description: this.description.trim(),
      base: this.base,
      serves: this.serves,
      difficulty: this.difficulty,
      servings: Math.max(1, Math.round(Number(this.servings) || 1)),
      prepTime: Math.max(0, Math.round(Number(this.prepTime) || 0)),
      published: this.published,
      featured: this.published && this.featured,
      ingredients: this.ingredients
        .filter((item) => item.name.trim())
        .map((item) => ({
          name: item.name.trim(),
          quantity: normalizeQuantity(item.quantity),
          unit: item.unit
        })),
      tools: this.tools
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim() })),
      steps: this.steps
        .filter((item) => item.title.trim() || item.description.trim())
        .map((item) => {
          const timer = this.timerSeconds(item);
          return {
            title: item.title.trim(),
            description: item.description.trim(),
            timer_seconds: timer === 'invalid' ? null : timer
          };
        }),
      related_products: this.canLink ? this.linkedIds : (this.saved?.linkedIds || []),
      replace_recipe_id: this.needsReplacement ? this.replaceId : null,
      hero_image: hero
    };
    // Community content belongs to its owner: admins only send the featured flag.
    const featureOnly: AdminRecipeFeatureDraft = {
      featured: body.featured,
      replace_recipe_id: body.replace_recipe_id
    };
    const request = this.creating
      ? this.recipesApi.create(body)
      : this.recipesApi.update(this.recipeId, this.canEditContent ? body : featureOnly);
    request.subscribe({
      next: (response) => {
        this.saving = false;
        if (this.creating) {
          this.allowLeave = true;
          void this.router.navigate(['/admin/recipes', response.data.recipe_id], { replaceUrl: true });
          return;
        }
        this.applyDetail(response.data);
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.saving = false;
        this.error = error?.error?.error || 'Could not save this recipe.';
        this.cdr.markForCheck();
      }
    });
  }

  private validate(): string {
    if (this.canEditContent) {
      if (!this.title.trim()) return 'Add a title.';
      if (!this.coverFile && !this.hero?.url) return 'Add a cover image.';
      if (!this.base) return 'Choose a base.';
      if (!this.difficulty) return 'Choose a difficulty.';
      if (!/^\d+$/.test(this.servings.trim()) || Number(this.servings) < 1 || Number(this.servings) > 99) {
        return 'Servings must be a whole number from 1 to 99.';
      }
      if (!/^\d+$/.test(this.prepTime.trim()) || Number(this.prepTime) > 999) {
        return 'Prep time must be a whole number of minutes up to 999.';
      }
      if (!this.ingredients.some((item) => item.name.trim())) return 'Add at least one ingredient.';
      if (this.ingredients.some((item) => item.name.trim() && !isValidQuantity(item.quantity))) {
        return 'Use amounts like 2, 1/2, 1 1/2, or 6-8.';
      }
      if (this.steps.some((item) => this.timerSeconds(item) === 'invalid')) {
        return 'Step timers use minutes and seconds, with seconds under 60.';
      }
      if (!this.steps.some((item) => item.title.trim() || item.description.trim())) return 'Add at least one step.';
    }
    if (this.needsReplacement && !this.featuredSlots.some((item) => item.recipe_id === this.replaceId)) {
      return 'Choose which homepage recipe to replace.';
    }
    if (this.canLink && this.linkedIds.length > 3) return 'Link up to 3 products.';
    return '';
  }

  private fetchSuggestions(key: string): void {
    const hints = this.hintNames();
    if (!hints.length) {
      this.suggestions = [];
      this.suggestionKey = key;
      this.cdr.markForCheck();
      return;
    }
    this.recipesApi.searchProducts('', hints).subscribe({
      next: (response) => {
        if (key !== this.hintNames().join('\n')) return;
        this.suggestions = response.data || [];
        this.suggestions.forEach((product) => this.remember(product));
        this.suggestionKey = key;
        this.cdr.markForCheck();
      }
    });
  }

  private hintNames(): string[] {
    return [
      ...this.ingredients.map((item) => item.name.trim()),
      ...this.tools.map((item) => item.name.trim())
    ].filter(Boolean);
  }

  private snapshot(): Snapshot {
    return {
      title: this.title,
      description: this.description,
      base: this.base,
      serves: [...this.serves],
      difficulty: this.difficulty,
      servings: this.servings,
      prepTime: this.prepTime,
      published: this.published,
      featured: this.featured,
      replaceId: this.replaceId,
      linkedIds: [...this.linkedIds],
      ingredients: this.ingredients.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit })),
      tools: this.tools.map((item) => ({ name: item.name })),
      steps: this.steps.map((item) => ({
        title: item.title,
        description: item.description,
        minutes: item.minutes,
        seconds: item.seconds
      }))
    };
  }

  private applySnapshot(snapshot: Snapshot): void {
    this.title = snapshot.title;
    this.description = snapshot.description;
    this.base = snapshot.base;
    this.serves = [...snapshot.serves];
    this.difficulty = snapshot.difficulty;
    this.servings = snapshot.servings;
    this.prepTime = snapshot.prepTime;
    this.published = snapshot.published;
    this.featured = snapshot.featured;
    this.replaceId = snapshot.replaceId;
    this.linkedIds = [...snapshot.linkedIds];
    this.ingredients = snapshot.ingredients.map((item) => ({ key: this.nextKey++, ...item }));
    this.tools = snapshot.tools.map((item) => ({ key: this.nextKey++, ...item }));
    this.steps = snapshot.steps.map((item) => ({
      key: this.nextKey++,
      ...item,
      timerOpen: Boolean(item.minutes.trim() || item.seconds.trim())
    }));
    this.suggestionKey = '';
    this.onNameInput();
  }

  private remember(product: LinkableProduct): void {
    this.productMap.set(product.product_id, product);
  }

  private amount(quantity: string, unit: string): string {
    if (quantity === '') return '';
    return `${quantity}${unit || ''}`;
  }

  private dateLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private orderedServes(values: string[]): string[] {
    const selected = new Set(values);
    return this.serveOptions.map((item) => item.value).filter((value) => selected.has(value));
  }

  private blankIngredient(): IngredientRow {
    return { key: this.nextKey++, name: '', quantity: '', unit: '' };
  }

  private blankTool(): ToolRow {
    return { key: this.nextKey++, name: '' };
  }

  private blankStep(): StepRow {
    return { key: this.nextKey++, title: '', description: '', minutes: '', seconds: '', timerOpen: false };
  }

  private timerSeconds(step: StepRow): number | null | 'invalid' {
    const minutes = step.minutes.trim();
    const seconds = step.seconds.trim();
    if (!minutes && !seconds) return null;
    if ((minutes && !/^\d+$/.test(minutes)) || (seconds && !/^\d+$/.test(seconds))) return 'invalid';
    const min = minutes ? Number(minutes) : 0;
    const sec = seconds ? Number(seconds) : 0;
    if (min > 180 || sec > 59) return 'invalid';
    const total = min * 60 + sec;
    return total > 0 ? total : null;
  }

  private stepFrom(step: { title?: string; description?: string; timer_seconds?: number | null }): StepRow {
    const total = step.timer_seconds && step.timer_seconds > 0 ? step.timer_seconds : 0;
    return {
      key: this.nextKey++,
      title: step.title || '',
      description: step.description || '',
      minutes: total ? String(Math.floor(total / 60)) : '',
      seconds: total ? String(total % 60) : '',
      timerOpen: total > 0
    };
  }

  private revokePreview(): void {
    if (!this.coverPreview) return;
    URL.revokeObjectURL(this.coverPreview);
    this.coverPreview = null;
  }

  private finishLeave(allow: boolean): void {
    const resolve = this.leaveResolve;
    this.leavePrompt = false;
    this.leavePromise = null;
    this.leaveResolve = null;
    resolve?.(allow);
    this.cdr.markForCheck();
  }

  private failAction(error: { error?: { error?: string } }): void {
    this.actionError = error?.error?.error || 'Could not update this recipe.';
    this.savingAction = false;
    this.cdr.markForCheck();
  }
}
