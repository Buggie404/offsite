import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowRight, LucideCalendar, LucideDownload } from '@lucide/angular';
import {
  AdminDashboardService, ArchetypeStat, Change, DashboardData, DashboardResponse, MembershipTier, RevenuePoint
} from '../../services/admin-dashboard.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

type RangeKey = '7' | '30' | '90' | 'custom';

export interface DeltaChip { text: string; tone: 'up' | 'down' | 'flat'; }

export interface KpiCard {
  key: string;
  label: string;
  value: string;
  caption: string;
  delta: DeltaChip;
  /** Sparkline polyline / area in a 100x28 box */
  spark: { line: string; area: string; tone: 'up' | 'down' };
}

export interface OpenWorkTile {
  key: string;
  label: string;
  count: number;
  caption: string;
  /** Money or a paying customer at risk: tinted while there is anything to handle */
  urgent: boolean;
  path: string;
  queryParams?: Record<string, string>;
}

export interface ChartBar {
  left: number;
  width: number;
  oneTime: number;
  ritualBox: number;
  point: RevenuePoint;
}

const Y_TICKS = 4;
const SPARK_W = 100;
const SPARK_H = 28;
/** Bar width as a share of its slot (15px of 19.4px in the design) */
const BAR_FILL = 0.77;
const TIER_ORDER: MembershipTier[] = ['Seed', 'Leaf', 'Bloom', 'Zen'];

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideArrowRight, LucideCalendar, LucideDownload],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class AdminDashboardComponent implements OnInit {
  private readonly dashboardService = inject(AdminDashboardService);
  private readonly router = inject(Router);
  private readonly adminAuth = inject(AdminAuthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private requestVersion = 0;

  readonly ranges: { key: RangeKey; label: string }[] = [
    { key: '7', label: '7 days' },
    { key: '30', label: '30 days' },
    { key: '90', label: '90 days' },
    { key: 'custom', label: 'Custom' }
  ];

  range: RangeKey = '30';
  /** Applied custom dates (YYYY-MM-DD) */
  customStart = '';
  customEnd = '';
  // Custom range panel (same as admin/orders): the draft dates load only after "Apply range"
  showCustomRange = false;
  customDateFrom = '';
  customDateTo = '';
  customRangeError: string | null = null;
  readonly maxDate = this.localDate(new Date());
  data: DashboardData | null = null;
  initialLoading = true;
  refreshing = false;
  error = '';
  /** Index of the revenue bar under the mouse */
  hoverIndex: number | null = null;

  ngOnInit(): void {
    this.load();
  }

  selectRange(range: RangeKey): void {
    if (range === 'custom') {
      this.openCustomRange();
      return;
    }
    this.showCustomRange = false;
    this.customRangeError = null;
    this.range = range;
    this.load(range);
  }

  openCustomRange(): void {
    this.customRangeError = null;
    if (this.customStart && this.customEnd) {
      this.customDateFrom = this.customStart;
      this.customDateTo = this.customEnd;
    } else {
      // Default to the last 30 days, like the Orders filter.
      const from = new Date();
      from.setDate(from.getDate() - 29);
      this.customDateFrom = this.localDate(from);
      this.customDateTo = this.maxDate;
    }
    this.showCustomRange = true;
  }

  applyCustomRange(): void {
    this.customRangeError = null;
    if (!this.customDateFrom || !this.customDateTo) {
      this.customRangeError = 'Please enter both a start date and an end date (dd/mm/yyyy).';
      return;
    }
    if (this.customDateTo > this.maxDate) {
      this.customRangeError = 'Dates can’t be in the future.';
      return;
    }
    if (this.customDateFrom > this.customDateTo) {
      this.customRangeError = 'Start date must be on or before the end date.';
      return;
    }
    this.customStart = this.customDateFrom;
    this.customEnd = this.customDateTo;
    this.showCustomRange = false;
    this.range = 'custom';
    this.load('custom');
  }

  /** Nothing loads until Apply, so cancelling keeps the range already on screen. */
  cancelCustomRange(): void {
    this.showCustomRange = false;
    this.customRangeError = null;
  }

  onCustomDateFromChange(value: string): void {
    this.customDateFrom = value;
    this.customRangeError = null;
  }

  onCustomDateToChange(value: string): void {
    this.customDateTo = value;
    this.customRangeError = null;
  }

  // The fields show dd/mm/yyyy whatever the browser locale; the model stays YYYY-MM-DD.

  /** YYYY-MM-DD -> dd/mm/yyyy */
  displayDate(value: string): string {
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}/${month}/${year}` : '';
  }

  /** Keeps digits only and adds the slashes while typing: 0511 -> 05/11 */
  maskDateInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    input.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
  }

  onTypedDate(field: 'from' | 'to', text: string): void {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
    const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
    const date = iso ? new Date(`${iso}T00:00:00`) : null;
    // Reject impossible dates such as 31/02/2026 (Date would roll them over).
    const valid = !!date && !Number.isNaN(date.getTime()) && this.localDate(date) === iso;
    if (field === 'from') this.customDateFrom = valid ? iso : '';
    else this.customDateTo = valid ? iso : '';
    if (text.trim() && !valid) this.customRangeError = 'Enter a valid date as dd/mm/yyyy.';
    else if (valid && iso > this.maxDate) this.customRangeError = 'Dates can’t be in the future.';
    else this.customRangeError = null;
  }

  openPicker(picker: HTMLInputElement): void {
    try {
      picker.showPicker();
    } catch {
      picker.click(); // browsers without showPicker()
    }
  }

  load(range: RangeKey = this.range): void {
    const dates = this.getRange(range);
    if (!dates) return;
    const requestVersion = ++this.requestVersion;
    this.initialLoading = this.data === null;
    this.refreshing = this.data !== null;
    this.error = '';
    this.hoverIndex = null;
    const includeTodos = this.data === null;
    this.dashboardService.getDashboard(dates.start, dates.end, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', includeTodos).subscribe({
      // Ignore late responses from a previously selected range.
      next: data => {
        if (requestVersion !== this.requestVersion) return;
        this.applyResponse(data);
        this.initialLoading = false;
        this.refreshing = false;
        // This application runs zoneless. HTTP callbacks do not automatically
        // schedule template rendering, so mark the new filter data explicitly.
        this.cdr.markForCheck();
      },
      error: err => {
        if (requestVersion !== this.requestVersion) return;
        this.error = err?.error?.error || 'Dashboard data could not be loaded.';
        this.initialLoading = false;
        this.refreshing = false;
        this.cdr.markForCheck();
      }
    });
  }

  get greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  get accountName(): string {
    return this.adminAuth.getDisplayName();
  }

  get periodLabel(): string {
    if (this.range !== 'custom') return `Last ${this.range} days vs previous ${this.range} days`;
    const days = Math.round((this.startOfDay(this.customEnd)!.getTime() - this.startOfDay(this.customStart)!.getTime()) / 86_400_000) + 1;
    return `${this.shortDate(this.customStart)} – ${this.shortDate(this.customEnd)} vs previous ${days} day${days === 1 ? '' : 's'}`;
  }

  // ── KPI cards ──

  get cards(): KpiCard[] {
    const k = this.data?.kpis;
    if (!k) return [];
    const repeat = k.repeat_customers;
    return [
      {
        key: 'revenue', label: 'Net revenue', value: this.money(k.net_revenue.value),
        caption: `after refunds · ${Math.round(k.net_revenue.ritual_box_share)}% from Ritual Box`,
        delta: this.pctChip(k.net_revenue.change_pct), spark: this.spark(k.net_revenue.spark, k.net_revenue.change_pct)
      },
      {
        key: 'orders', label: 'Orders', value: k.orders.value.toLocaleString('en-US'),
        caption: `AOV ${this.money(k.orders.aov, 2)}${k.orders.aov_change_pct === null ? '' : ` · ${this.arrow(k.orders.aov_change_pct)} ${Math.abs(Math.round(k.orders.aov_change_pct))}%`}`,
        delta: this.pctChip(k.orders.change_pct), spark: this.spark(k.orders.spark, k.orders.change_pct)
      },
      {
        key: 'boxes', label: 'Active Ritual Boxes', value: k.active_boxes.value.toLocaleString('en-US'),
        caption: `+${k.active_boxes.new} new · −${k.active_boxes.cancelled} cancelled`,
        delta: k.active_boxes.change
          ? { text: `${this.arrow(k.active_boxes.change)} ${Math.abs(k.active_boxes.change)}`, tone: k.active_boxes.change > 0 ? 'up' : 'down' }
          : { text: '0', tone: 'flat' },
        spark: this.spark(k.active_boxes.spark, k.active_boxes.change)
      },
      {
        key: 'repeat', label: 'Repeat customers', value: repeat.value === null ? '—' : `${repeat.value.toFixed(1)}%`,
        caption: '≥ 2 orders in 90 days',
        delta: repeat.change_pt === null
          ? { text: '—', tone: 'flat' }
          : { text: `${this.arrow(repeat.change_pt)} ${Math.abs(repeat.change_pt).toFixed(1)} pt`, tone: this.tone(repeat.change_pt) },
        spark: this.spark(repeat.spark, repeat.change_pt)
      }
    ];
  }

  private pctChip(change: Change): DeltaChip {
    if (change === null) return { text: 'New', tone: 'up' };
    const size = Math.abs(change);
    return { text: `${this.arrow(change)} ${size.toFixed(size >= 100 ? 0 : 1)}%`, tone: this.tone(change) };
  }

  private arrow(change: number): string { return change < 0 ? '▼' : '▲'; }

  private tone(change: number): DeltaChip['tone'] {
    if (Math.abs(change) < 0.05) return 'flat';
    return change > 0 ? 'up' : 'down';
  }

  private spark(values: number[], change: Change): KpiCard['spark'] {
    const tone = change !== null && change < 0 ? 'down' : 'up';
    if (values.length < 2) return { line: '', area: '', tone };
    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    const points = values.map((value, i) =>
      `${((i * SPARK_W) / (values.length - 1)).toFixed(1)},${(SPARK_H - 1 - ((value - min) / span) * (SPARK_H - 2)).toFixed(1)}`);
    const line = points.join(' ');
    return { line, area: `0,${SPARK_H} ${line} ${SPARK_W},${SPARK_H}`, tone };
  }

  // ── Open work ──

  get openWork(): OpenWorkTile[] {
    const w = this.data?.open_work;
    if (!w) return [];
    const atRisk = w.boxes_payment_failed + w.boxes_suspended;
    return [
      { key: 'refunds', label: 'Refunds waiting', count: w.refunds_waiting, caption: 'Orders · pending refund', urgent: true,
        path: '/admin/orders', queryParams: { status: 'pending_refund', date: '90' } },
      { key: 'reports', label: 'Reports to review', count: w.reports_to_review, caption: 'Community reports', urgent: false,
        path: '/admin/community-reports' },
      { key: 'chats', label: 'Chats waiting', count: w.chats_waiting, caption: 'Support chat', urgent: false,
        path: '/admin/chat', queryParams: { status: 'waiting' } },
      { key: 'boxes', label: 'Boxes at risk', count: atRisk, caption: `${w.boxes_payment_failed} payment failed · ${w.boxes_suspended} suspended`,
        urgent: true, path: '/admin/subscriptions', queryParams: { status: 'needs_action' } },
      { key: 'not-started', label: 'Box not started', count: w.boxes_not_started, caption: 'paid, customer didn’t start', urgent: true,
        path: '/admin/orders', queryParams: { attention: 'ritual_box_not_started' } },
      { key: 'stock', label: 'Out of stock', count: w.out_of_stock_variants, caption: w.out_of_stock_variants === 1 ? 'variant' : 'variants',
        urgent: false, path: '/admin/products' }
    ];
  }

  openTile(tile: OpenWorkTile): void {
    void this.router.navigate([tile.path], { queryParams: tile.queryParams });
  }

  // ── Revenue chart ──

  get periodRevenue(): number { return this.sum(this.data?.revenue_series, row => row.one_time + row.ritual_box); }
  get previousRevenue(): number { return this.sum(this.data?.revenue_series, row => row.previous); }

  /** Rounded-up top of the y axis so grid labels are readable numbers */
  private get chartMax(): number {
    const max = Math.max(0, ...(this.data?.revenue_series || []).map(row => Math.max(row.one_time + row.ritual_box, row.previous)));
    if (max <= 0) return 100;
    const magnitude = 10 ** Math.floor(Math.log10(max));
    const step = [1, 1.5, 2, 2.5, 3, 5, 6, 10].find(s => s * magnitude * Y_TICKS >= max) || 10;
    return step * magnitude * Y_TICKS;
  }

  get yTicks(): { label: string; top: number }[] {
    const max = this.chartMax;
    return Array.from({ length: Y_TICKS + 1 }, (_, i) => ({ label: this.compactMoney((max * (Y_TICKS - i)) / Y_TICKS), top: (i / Y_TICKS) * 100 }));
  }

  get bars(): ChartBar[] {
    const rows = this.data?.revenue_series || [];
    const max = this.chartMax;
    const slot = 100 / Math.max(rows.length, 1);
    return rows.map((point, i) => ({
      left: i * slot + (slot * (1 - BAR_FILL)) / 2,
      width: slot * BAR_FILL,
      oneTime: (point.one_time / max) * 100,
      ritualBox: (point.ritual_box / max) * 100,
      point
    }));
  }

  /** Previous period as a dashed line through the bar centres, in a 100x100 box */
  get previousLine(): string {
    const rows = this.data?.revenue_series || [];
    const max = this.chartMax;
    const slot = 100 / Math.max(rows.length, 1);
    return rows.map((row, i) => `${(i * slot + slot / 2).toFixed(2)},${(100 - (row.previous / max) * 100).toFixed(2)}`).join(' ');
  }

  /** About six labels under the bars, e.g. "02 Oct" */
  get xLabels(): { label: string; left: number }[] {
    const rows = this.data?.revenue_series || [];
    const every = Math.max(1, Math.ceil(rows.length / 6));
    const slot = 100 / Math.max(rows.length, 1);
    return rows
      .map((row, i) => ({ label: this.axisDate(row.date), left: i * slot + slot / 2, i }))
      .filter(item => item.i % every === 0);
  }

  get hoverBar(): ChartBar | null {
    return this.hoverIndex === null ? null : this.bars[this.hoverIndex] || null;
  }

  onChartMove(event: MouseEvent): void {
    const rows = this.data?.revenue_series || [];
    if (!rows.length) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 0.9999);
    this.hoverIndex = Math.floor(ratio * rows.length);
  }

  // ── Ritual DNA ──

  /**
   * Group shares of all customers rounded to 0.1% so that the groups plus
   * "no quiz yet" add up to exactly 100% (largest remainder).
   */
  get archetypeShares(): { groups: Map<string, number>; noQuiz: number } {
    const groups = this.data?.archetypes || [];
    const coverage = this.data?.ritual_dna_coverage;
    const total = coverage?.customers || 0;
    if (!total) return { groups: new Map(groups.map(a => [a.archetype_id, 0])), noQuiz: 0 };
    const buckets = [
      ...groups.map(a => ({ key: a.archetype_id, count: a.customers })),
      { key: '', count: Math.max(total - (coverage?.quiz_customers || 0), 0) }
    ].map(b => {
      const tenths = (b.count / total) * 1000;
      return { ...b, tenths: Math.floor(tenths), rest: tenths - Math.floor(tenths) };
    });
    let missing = 1000 - buckets.reduce((sum, b) => sum + b.tenths, 0);
    // Round up whole tie groups only, so groups of the same size always show the same %.
    const byRest = [...buckets].sort((a, c) => c.rest - a.rest);
    for (let i = 0; i < byRest.length && missing > 0;) {
      const ties = byRest.filter(b => Math.abs(b.rest - byRest[i].rest) < 1e-9);
      if (ties.length > missing) break;
      ties.forEach(b => (b.tenths += 1));
      missing -= ties.length;
      i += ties.length;
    }
    // Whatever is left goes to the biggest bucket, where 0.1% matters least.
    if (missing > 0) buckets.reduce((big, b) => (b.count > big.count ? b : big)).tenths += missing;
    return {
      groups: new Map(buckets.filter(b => b.key).map(b => [b.key, b.tenths / 10])),
      noQuiz: buckets.find(b => !b.key)!.tenths / 10
    };
  }

  get ritualDnaCoverage(): string {
    const coverage = this.data?.ritual_dna_coverage;
    if (!coverage?.customers) return 'No customers yet';
    const noQuiz = coverage.customers - coverage.quiz_customers;
    return `${coverage.quiz_customers.toLocaleString('en-US')} of ${coverage.customers.toLocaleString('en-US')} customers took the Ritual DNA quiz`
      + ` · ${noQuiz.toLocaleString('en-US')} (${this.archetypeShares.noQuiz.toFixed(1)}%) haven’t yet`;
  }

  /** Rule-based one-liner: biggest-but-least-loyal group first, else the best spender. */
  get archetypeInsight(): { lead: string; rest: string } {
    const groups = (this.data?.archetypes || []).filter(a => a.customers > 0);
    const withRepeat = groups.filter((a): a is ArchetypeStat & { repeat_rate: number } => a.repeat_rate !== null);
    if (withRepeat.length >= 2) {
      const bySize = [...groups].sort((a, b) => b.share - a.share);
      const weakest = [...withRepeat].sort((a, b) => a.repeat_rate - b.repeat_rate)[0];
      const rank = bySize.indexOf(weakest);
      const average = withRepeat.reduce((sum, a) => sum + a.repeat_rate, 0) / withRepeat.length;
      if (rank <= 1 && weakest.repeat_rate < average) {
        return {
          lead: `${weakest.name} is the ${rank === 0 ? '' : '2nd '}biggest group but repeats the least.`,
          rest: ` Worth testing a bundle or Ritual Box built around ${weakest.top_pick || 'what they already buy'}.`
        };
      }
    }
    const best = [...groups].sort((a, b) => b.revenue_per_customer - a.revenue_per_customer)[0];
    if (best?.revenue_per_customer) {
      return {
        lead: `${best.name} spends the most per customer (${this.money(best.revenue_per_customer)}).`,
        rest: best.top_pick ? ` Lead with ${best.top_pick} in their recommendations and Ritual Box offers.` : ''
      };
    }
    return { lead: 'Not enough orders from Ritual DNA customers yet.', rest: ' Insights appear once quiz takers start buying in this period.' };
  }

  /** The group that repeats the least is shown in red. */
  isWeakestRepeat(archetype: ArchetypeStat): boolean {
    const rates = (this.data?.archetypes || []).map(a => a.repeat_rate).filter((rate): rate is number => rate !== null);
    return archetype.repeat_rate !== null && rates.length > 1 && archetype.repeat_rate === Math.min(...rates);
  }

  // ── Retention ──

  get tierSegments(): { tier: MembershipTier; share: number; label: string; title: string }[] {
    const tiers = this.data?.retention.tiers || [];
    const total = tiers.reduce((sum, t) => sum + t.customers, 0);
    if (!total) return [];
    return TIER_ORDER
      .map(tier => tiers.find(t => t.tier === tier))
      .filter((t): t is NonNullable<typeof t> => !!t && t.customers > 0)
      .map(t => {
        const share = (t.customers / total) * 100;
        const pct = `${Math.round(share)}%`;
        return {
          tier: t.tier,
          share,
          // Name only when the segment is wide enough to hold it
          label: share >= 15 ? `${t.tier} ${pct}` : share >= 6 ? pct : '',
          title: `${t.tier}: ${t.customers.toLocaleString('en-US')} members (${pct}) · ${this.money(t.revenue)} revenue this period`
        };
      });
  }

  get brewCoachInsight(): { before: string; strong: string; after: string } {
    const { with_rate, without_rate } = this.data?.retention.brew_coach || { with_rate: null, without_rate: null };
    if (with_rate === null || without_rate === null) return { before: 'Not enough buyers on both sides to compare yet.', strong: '', after: '' };
    if (!without_rate) return { before: 'Only Brew Coach users have come back so far.', strong: '', after: '' };
    const ratio = with_rate / without_rate;
    if (ratio <= 1.05) return { before: 'Brew Coach users come back ', strong: 'no more often', after: ' than other customers yet.' };
    return { before: 'Brew Coach users come back ', strong: `${ratio.toFixed(1)}× more`, after: ' than other customers.' };
  }

  exportRevenue(): void {
    const rows = this.data?.revenue_series || [];
    const csv = ['Date,One-time,Ritual Box,Net revenue,Previous period',
      ...rows.map(row => [row.date, row.one_time, row.ritual_box, row.one_time + row.ritual_box, row.previous].map(v => typeof v === 'number' ? v.toFixed(2) : v).join(','))
    ].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `revenue-${this.rangeLabel().replaceAll(' ', '-').toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  money(value: number, digits = 0): string {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  signedMoney(value: number): string {
    return `${value < 0 ? '−' : '+'}${this.money(Math.abs(value))}`;
  }

  private compactMoney(value: number): string {
    if (value >= 1000) return `$${+(value / 1000).toFixed(1)}k`;
    return `$${+value.toFixed(value < 10 ? 1 : 0)}`;
  }

  private sum<T>(rows: T[] | undefined, pick: (row: T) => number): number {
    return (rows || []).reduce((total, row) => total + pick(row), 0);
  }

  private applyResponse(response: DashboardResponse): void {
    if (response.open_work) {
      this.data = response as DashboardData;
      return;
    }
    // Open work counts are independent of the selected period. They stay in
    // place while a range refetch updates everything else.
    if (this.data) this.data = { ...response, open_work: this.data.open_work };
  }

  private getRange(range: RangeKey): { start: Date; end: Date } | null {
    if (range === 'custom') {
      const start = this.startOfDay(this.customStart);
      const end = this.endOfDay(this.customEnd);
      return start && end && start <= end ? { start, end } : null;
    }
    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(range) - 1));
    return { start, end };
  }

  private axisDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleDateString('en-US', { month: 'short' })}`;
  }

  longDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  private shortDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private startOfDay(value: string): Date | null {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private endOfDay(value: string): Date | null {
    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private localDate(date: Date): string {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  private rangeLabel(): string { return this.range === 'custom' ? `${this.customStart}-${this.customEnd}` : `${this.range} days`; }
}
