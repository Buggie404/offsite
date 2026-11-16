import { LucideArrowRight, LucideAsterisk, LucideCoffee, LucideFlaskConical, LucideLeaf, LucideSparkle, LucideZap } from '@lucide/angular';
import {
  AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, PLATFORM_ID, ViewChild,
  computed, inject, output, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

type Axis = 'brightness' | 'boldness' | 'sweetness' | 'skill' | 'tempo';

interface SampleArchetype {
  id: string;
  name: string;
  tagline: string;
  icon: 'leaf' | 'flask' | 'zap' | 'coffee';
  radar: Record<Axis, number>;
}

const AXES: Axis[] = ['brightness', 'boldness', 'sweetness', 'skill', 'tempo'];

// Mirrors the archetype signatures in backend/src/services/ritual-dna.config.js
const ARCHETYPES: SampleArchetype[] = [
  { id: 'ARC0001', name: 'Zen Purist', tagline: 'Calm, precise, and quietly intentional.', icon: 'leaf',
    radar: { brightness: 69, boldness: 18, sweetness: 22, skill: 60, tempo: 28 } },
  { id: 'ARC0002', name: 'Modern Alchemist', tagline: 'Curious, expressive, and always experimenting.', icon: 'flask',
    radar: { brightness: 62, boldness: 39, sweetness: 54, skill: 75, tempo: 51 } },
  { id: 'ARC0003', name: 'Daily Fuel', tagline: 'Bold, direct, and ready to move.', icon: 'zap',
    radar: { brightness: 25, boldness: 80, sweetness: 25, skill: 32, tempo: 88 } },
  { id: 'ARC0004', name: 'Cozy Ritualist', tagline: 'Soft, comforting, and made to linger over.', icon: 'coffee',
    radar: { brightness: 27, boldness: 20, sweetness: 82, skill: 28, tempo: 35 } },
];

const SHUFFLE_MS = 720;

@Component({
  selector: 'app-hero-dna-slide',
  standalone: true,
  imports: [LucideArrowRight, LucideAsterisk, LucideCoffee, LucideFlaskConical, LucideLeaf, LucideSparkle, LucideZap],
  templateUrl: './hero-dna-slide.component.html',
  styleUrls: ['./hero-dna-slide.component.scss'],
})
export class HeroDnaSlideComponent implements AfterViewInit, OnChanges, OnDestroy {
  /** Only animate the scene while this slide is the one on screen. */
  @Input() active = false;
  /** Fired when the visitor picks an archetype, so the carousel can restart its timer. */
  readonly interact = output<void>();

  @ViewChild('scene') private sceneRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('stack') private stackRef?: ElementRef<HTMLElement>;
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly auth = inject(AuthService);
  private readonly authPrompt = inject(AuthPromptModalService);
  private readonly router = inject(Router);

  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly archetypes = ARCHETYPES;
  /** Stack order, front card first. */
  readonly order = signal(['ARC0002', 'ARC0001', 'ARC0004', 'ARC0003']);
  readonly selectedId = computed(() => this.order()[0]);
  readonly selected = computed(() => ARCHETYPES.find(a => a.id === this.selectedId())!);
  readonly leavingId = signal<string | null>(null);
  readonly enteringId = signal<string | null>(null);
  readonly enteringFrom = signal(1);
  /** True for a moment after the banner comes on screen, while the cards are dealt in. */
  readonly dealing = signal(false);
  private dealTimer?: ReturnType<typeof setTimeout>;
  private wasActive = false;
  private cardScale = 1;

  private shuffleTimer?: ReturnType<typeof setTimeout>;
  private frame = 0;
  private clock = 0;
  private lastTick = 0;
  private width = 0;
  private height = 0;
  private resizeObserver?: ResizeObserver;
  private reducedMotion = false;
  // pointer parallax (−1…1), eased towards its target every frame
  private pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  // callout numbers ease towards the selected archetype's scores
  private shown: Record<Axis, number> | null = null;

  ngAfterViewInit(): void {
    if (!this.isBrowser || !this.sceneRef) return;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = this.sceneRef.nativeElement;
    this.resizeObserver = new ResizeObserver(() => { this.resize(); this.draw(); });
    this.resizeObserver.observe(canvas);
    this.resize();
    this.draw();
    this.syncLoop();
  }

  ngOnChanges(): void {
    if (this.active && !this.wasActive && this.isBrowser) {
      this.dealing.set(true);
      clearTimeout(this.dealTimer);
      this.dealTimer = setTimeout(() => this.dealing.set(false), 1300);
    }
    this.wasActive = this.active;
    this.syncLoop();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    clearTimeout(this.shuffleTimer);
    clearTimeout(this.dealTimer);
  }

  openRitualDna(): void {
    if (!this.auth.isAuthenticated()) {
      this.authPrompt.open();
      return;
    }
    void this.router.navigate(['/ritual-dna']);
  }

  posOf(id: string): number { return this.order().indexOf(id); }

  onPointer(event: PointerEvent): void {
    if (this.reducedMotion || event.pointerType === 'touch') return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.pointer.tx = ((event.clientX - box.left) / box.width) * 2 - 1;
    this.pointer.ty = ((event.clientY - box.top) / box.height) * 2 - 1;
  }

  onPointerLeave(): void { this.pointer.tx = 0; this.pointer.ty = 0; }

  select(id: string): void {
    this.interact.emit();
    const current = this.order();
    if (current[0] === id) return;
    const previousFront = current[0];
    this.enteringFrom.set(current.indexOf(id));
    this.order.set([id, ...current.slice(1).filter(x => x !== id), previousFront]);
    this.leavingId.set(previousFront);
    this.enteringId.set(id);
    clearTimeout(this.shuffleTimer);
    this.shuffleTimer = setTimeout(() => { this.leavingId.set(null); this.enteringId.set(null); }, SHUFFLE_MS);
    if (!this.frame) this.draw();
  }

  radarPoints(radar: Record<Axis, number>): string {
    return AXES.map((key, index) => {
      const angle = (-90 + index * 72) * Math.PI / 180;
      const radius = 78 * Math.max(0, Math.min(100, radar[key])) / 100;
      return `${(100 + Math.cos(angle) * radius).toFixed(1)},${(100 + Math.sin(angle) * radius).toFixed(1)}`;
    }).join(' ');
  }

  // ── Animated scene (planet + helix) ─────────────────────────

  private syncLoop(): void {
    if (!this.isBrowser || !this.sceneRef) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (!this.active || this.reducedMotion) return;
    this.lastTick = 0;
    this.zone.runOutsideAngular(() => {
      const tick = (now: number) => {
        if (this.lastTick) this.clock += Math.min(0.05, (now - this.lastTick) / 1000);
        this.lastTick = now;
        this.draw();
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  private resize(): void {
    const canvas = this.sceneRef!.nativeElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = canvas.clientWidth;
    this.height = canvas.clientHeight;
    // The card grows and shrinks with the banner so it keeps its share of the composition.
    const scale = Math.max(0.85, Math.min(1.4, this.height / 690, this.width / 1560));
    this.cardScale = scale;
    this.hostRef.nativeElement.style.setProperty('--card-scale', scale.toFixed(3));
    canvas.width = Math.round(this.width * dpr);
    canvas.height = Math.round(this.height * dpr);
  }

  private draw(): void {
    const canvas = this.sceneRef?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !this.width || !this.height) return;
    const w = this.width, h = this.height, t = this.clock;
    const dpr = canvas.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const mobile = w <= 620, tablet = w <= 900;
    const cx = mobile ? w * 0.5 : tablet ? w * 0.7 : w * 0.575;
    const cy = mobile ? 150 : h * 0.5;
    const R = mobile ? 88 : Math.min(h * 0.225, w * 0.112);

    // Layers drift against each other with the pointer for a little depth.
    const p = this.pointer;
    p.x += (p.tx - p.x) * 0.06; p.y += (p.ty - p.y) * 0.06;
    const shift = mobile ? 0 : R * 0.07;
    const stack = this.stackRef?.nativeElement;
    if (stack) {
      stack.style.setProperty('--px', `${(p.x * shift * 1.3).toFixed(1)}px`);
      stack.style.setProperty('--py', `${(p.y * shift * 0.9).toFixed(1)}px`);
    }

    const target = this.selected().radar;
    if (!this.shown || !this.frame) this.shown = { ...target };
    else AXES.forEach(key => { this.shown![key] += (target[key] - this.shown![key]) * 0.09; });

    this.drawSparkles(ctx, w, h, cx - p.x * shift * 0.4, cy - p.y * shift * 0.4, R, t);
    this.drawPlanet(ctx, cx - p.x * shift, cy - p.y * shift, R, t);
    const hx = cx + p.x * shift * 0.9, hy = cy + p.y * shift * 0.5;
    this.drawHelix(ctx, hx, hy, R, Math.max(h, 400), t);
    if (w > 1280) this.drawAnnotations(ctx, w, hx, hy, R);
  }

  /** Specimen-style callouts on the helix, showing the selected archetype's scores. */
  private drawAnnotations(ctx: CanvasRenderingContext2D, w: number, cx: number, cy: number, R: number): void {
    const shown = this.shown ?? this.selected().radar;
    const radar = { brightness: Math.round(shown.brightness), sweetness: Math.round(shown.sweetness), boldness: Math.round(shown.boldness) };
    const tilt = 0.26, ax = cx + R * 0.05;
    // point on the (tilted) helix axis at distance y from the planet centre, pushed sideways by `side`
    const onHelix = (y: number, side: number): [number, number] =>
      [ax - Math.sin(tilt) * y + Math.cos(tilt) * side, cy + Math.cos(tilt) * y + Math.sin(tilt) * side];
    const ink = '#544a40', strong = '#1a1a1a';
    const mono = `'DM Mono', monospace`;
    const numberSize = Math.max(18, Math.round(R * 0.13)), labelSize = Math.max(9, Math.round(R * 0.055));
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };

    type Callout = { value: number; label: string; text: [number, number]; target: [number, number]; align: CanvasTextAlign };
    // The card stack sits on the right; only use that side when the gap is wide enough for a label.
    const cardLeft = w - Math.min(72, Math.max(28, w * 0.034)) - 345 * this.cardScale;
    const roomOnRight = cx + R * 0.86 + R * 0.75 < cardLeft;
    const callouts: Callout[] = roomOnRight ? [
      { value: radar.brightness, label: 'BRIGHTNESS ↘', text: [cx + R * 0.86, cy - R * 1.18], target: onHelix(-R * 0.92, R * 0.36), align: 'left' },
      { value: radar.sweetness, label: 'SWEETNESS ↖', text: [cx + R * 0.9, cy + R * 0.98], target: onHelix(R * 0.86, R * 0.3), align: 'left' },
      { value: radar.boldness, label: 'BOLDNESS ↗', text: [cx - R * 0.8, cy + R * 1.1], target: onHelix(R * 1.28, -R * 0.44), align: 'right' },
    ] : [
      { value: radar.brightness, label: 'BRIGHTNESS ↗', text: [cx - R * 0.72, cy - R * 1.3], target: onHelix(-R * 1.15, -R * 0.36), align: 'right' },
      { value: radar.boldness, label: 'BOLDNESS ↗', text: [cx - R * 0.8, cy + R * 1.1], target: onHelix(R * 1.28, -R * 0.44), align: 'right' },
    ];

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    callouts.forEach(({ value, label, text: [tx, ty], target: [px, py], align }) => {
      const anchorX = align === 'left' ? tx - R * 0.07 : tx + R * 0.07, anchorY = ty + R * 0.05;
      ctx.strokeStyle = ink; ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(anchorX, anchorY); ctx.lineTo(px, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f8f1ea';
      ctx.beginPath(); ctx.arc(anchorX, anchorY, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      ctx.textAlign = align;
      spaced.letterSpacing = '0px';
      ctx.fillStyle = strong; ctx.font = `500 ${numberSize}px ${mono}`;
      ctx.fillText(String(value), tx, ty);
      spaced.letterSpacing = '1.5px';
      ctx.fillStyle = ink; ctx.font = `${labelSize}px ${mono}`;
      ctx.fillText(label, tx, ty + labelSize * 1.7);
    });

    spaced.letterSpacing = '0px';
    ctx.restore();
  }

  private drawSparkles(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, R: number, t: number): void {
    const stars: [number, number, number, string][] = [
      [-0.85, -1.02, 0.07, '#c4a882'], [-0.15, -1.36, 0.035, '#375534'], [1.22, 0.42, 0.045, '#375534'],
      [-1.02, 0.18, 0.03, '#c4a882'], [0.82, 1.24, 0.035, '#c4a882'], [1.5, -0.7, 0.03, '#c4a882'],
      [-1.5, -0.62, 0.028, '#375534'], [-1.32, 1.02, 0.04, '#c4a882'], [0.42, -1.48, 0.026, '#c4a882'],
    ];
    stars.forEach(([dx, dy, size, color], index) => {
      const x = cx + dx * R * 1.15, y = cy + dy * R;
      if (x < 0 || x > w || y < 0 || y > h) return;
      const s = size * R * (0.88 + 0.12 * Math.sin(t * 0.7 + index * 1.7));
      ctx.globalAlpha = 0.65 + 0.25 * Math.sin(t * 0.7 + index * 1.7);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x, y, x + s, y);
      ctx.quadraticCurveTo(x, y, x, y + s);
      ctx.quadraticCurveTo(x, y, x - s, y);
      ctx.quadraticCurveTo(x, y, x, y - s);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  private drawPlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number): void {
    // Surface drifts right → left; ring and orbit travel the same way across the front.
    const spin = -t * 0.12;
    const orbit = t * 0.16;
    const ink = (alpha: number) => `rgba(84, 74, 64, ${alpha})`;

    ctx.save();
    ctx.translate(cx, cy);

    const glow = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 1.9);
    glow.addColorStop(0, 'rgba(207, 225, 185, 0.42)');
    glow.addColorStop(1, 'rgba(207, 225, 185, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);

    ctx.rotate(-0.14);

    const ring = (half: 'back' | 'front') => {
      const [from, to] = half === 'back' ? [Math.PI, Math.PI * 2] : [0, Math.PI];
      ctx.lineCap = 'butt';
      // outer dotted orbit + hairline
      ctx.setLineDash([2, 5]);
      ctx.lineDashOffset = -orbit * R * 1.2;
      ctx.strokeStyle = ink(0.45); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.66, R * 0.36, 0, from, to); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(55, 85, 52, 0.55)';
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.56, R * 0.31, 0, from, to); ctx.stroke();
      // main band
      ctx.strokeStyle = 'rgba(196, 168, 130, 0.92)'; ctx.lineWidth = R * 0.04;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.4, R * 0.24, 0, from, to); ctx.stroke();
      // travelling highlights on the band
      ctx.setLineDash([R * 0.22, R * 0.5]);
      ctx.lineDashOffset = -orbit * R * 1.4;
      ctx.strokeStyle = 'rgba(250, 240, 235, 0.75)'; ctx.lineWidth = R * 0.016;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.4, R * 0.24, 0, from, to); ctx.stroke();
      ctx.setLineDash([]);
      // moons riding the orbits
      [[1.56, 0.31, 0, '#375534', 0.03], [1.66, 0.36, 2.4, '#c4a882', 0.022], [1.56, 0.31, 3.9, '#375534', 0.018]]
        .forEach(([rx, ry, phase, color, size]) => {
          const angle = ((orbit + (phase as number)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if ((half === 'front') !== (angle < Math.PI)) return;
          ctx.fillStyle = color as string;
          ctx.beginPath();
          ctx.arc(Math.cos(angle) * R * (rx as number), Math.sin(angle) * R * (ry as number), R * (size as number), 0, Math.PI * 2);
          ctx.fill();
        });
    };

    ring('back');

    // sphere
    const body = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
    body.addColorStop(0, '#f8eedd');
    body.addColorStop(0.7, '#eddcc0');
    body.addColorStop(1, '#e2cba6');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();

    ctx.strokeStyle = ink(0.16); ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 20) {
      const rad = lat * Math.PI / 180;
      ctx.beginPath(); ctx.ellipse(0, Math.sin(rad) * R, Math.cos(rad) * R, Math.cos(rad) * R * 0.1, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (let k = 0; k < 12; k++) {
      const lon = k * Math.PI / 6 + spin;
      if (Math.cos(lon) <= 0) continue;
      const s = Math.sin(lon);
      ctx.globalAlpha = Math.min(1, Math.cos(lon) * 2.2);
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(s) * R, R, 0, -Math.PI / 2, Math.PI / 2, s < 0); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // craters + speckles ride the surface
    const craters: [number, number, number][] = [[0.3, -0.42, 0.11], [1.5, -0.38, 0.06], [2.6, 0.3, 0.13], [3.6, -0.1, 0.08], [4.6, 0.42, 0.1], [5.5, 0.12, 0.07]];
    craters.forEach(([lon, lat, size]) => {
      const depth = Math.cos(lon + spin);
      if (depth <= 0.05) return;
      const x = R * Math.cos(lat) * Math.sin(lon + spin), y = R * Math.sin(lat);
      ctx.fillStyle = ink(0.13); ctx.strokeStyle = ink(0.3);
      ctx.beginPath(); ctx.ellipse(x, y, size * R * depth, size * R * 0.62, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    ctx.fillStyle = ink(0.38);
    for (let i = 0; i < 90; i++) {
      const lon = (i * 2.399963) % (Math.PI * 2), lat = Math.asin(((i * 0.6180339) % 1) * 1.7 - 0.85);
      const depth = Math.cos(lon + spin);
      if (depth <= 0) continue;
      ctx.globalAlpha = depth;
      ctx.beginPath();
      ctx.arc(R * Math.cos(lat) * Math.sin(lon + spin), R * Math.sin(lat), 0.6 + (i % 3) * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const shade = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.5, 0, 0, R * 1.05);
    shade.addColorStop(0, 'rgba(84, 74, 64, 0)');
    shade.addColorStop(1, 'rgba(84, 74, 64, 0.16)');
    ctx.fillStyle = shade;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();

    ctx.strokeStyle = ink(0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();

    ring('front');
    ctx.restore();
  }

  private drawHelix(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, h: number, t: number): void {
    // Rotates about its own axis; the near strand sweeps left → right.
    const phase = t * 0.32;
    const amplitude = R * 0.5, period = R * 2.3, k = Math.PI * 2 / period;
    const reach = h * 0.8, step = 6;
    const front = ['#375534', '#544a40'], back = ['#9fc38d', '#c9b08c'], rungColor = ['#7fa56f', '#b79b78'];

    ctx.save();
    ctx.translate(cx + R * 0.05, cy);
    ctx.rotate(0.26);
    ctx.lineCap = 'round';

    // rungs
    const rungGap = period / 9;
    const rungs: number[] = [];
    for (let y = -Math.ceil(reach / rungGap) * rungGap; y <= reach; y += rungGap) rungs.push(y);
    ctx.lineWidth = Math.max(2, R * 0.02);
    rungs.forEach(y => {
      const x = amplitude * Math.sin(k * y + phase);
      if (Math.abs(x) < amplitude * 0.12) return;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = rungColor[0];
      ctx.beginPath(); ctx.moveTo(x * 0.9, y); ctx.lineTo(x * 0.1, y); ctx.stroke();
      ctx.strokeStyle = rungColor[1];
      ctx.beginPath(); ctx.moveTo(-x * 0.1, y); ctx.lineTo(-x * 0.9, y); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // strands: far halves first, near halves on top
    const strand = (index: 0 | 1, near: boolean) => {
      const sign = index === 0 ? 1 : -1;
      for (let y = -reach; y < reach; y += step) {
        const a = k * y + phase, b = k * (y + step) + phase;
        const depth = sign * Math.cos((a + b) / 2);
        if ((depth >= 0) !== near) continue;
        const weight = Math.min(1, Math.abs(depth) * 1.6);
        ctx.strokeStyle = near ? front[index] : back[index];
        ctx.lineWidth = near ? R * (0.026 + 0.042 * weight) : R * 0.022;
        ctx.beginPath();
        ctx.moveTo(sign * amplitude * Math.sin(a), y);
        ctx.lineTo(sign * amplitude * Math.sin(b), y + step);
        ctx.stroke();
      }
    };
    strand(0, false); strand(1, false);
    strand(0, true); strand(1, true);

    // nodes where rungs meet the near strand
    rungs.forEach(y => {
      [0, 1].forEach(index => {
        const sign = index === 0 ? 1 : -1;
        const depth = sign * Math.cos(k * y + phase);
        if (depth < 0.3) return;
        const radius = R * 0.062 * Math.min(1, 0.55 + depth * 0.6);
        const x = sign * amplitude * Math.sin(k * y + phase);
        ctx.fillStyle = index === 0 ? '#fdf8ee' : '#ecd9b4';
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = Math.max(1.2, R * 0.008);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = front[index];
        ctx.beginPath(); ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2); ctx.fill();
      });
    });
    ctx.restore();
  }
}
