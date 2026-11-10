import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideDynamicIcon, provideLucideIcons } from '@lucide/angular';
import { QUIZ_LUCIDE_ICONS, quizIconName } from '../../../../shared/icons/quiz-lucide-icons';

@Component({
  selector: 'app-lucide-icon-picker',
  standalone: true,
  imports: [FormsModule, LucideDynamicIcon],
  providers: [provideLucideIcons(...QUIZ_LUCIDE_ICONS)],
  template: `
    <button type="button" class="icon-picker__current" (click)="toggle($event)" [attr.aria-expanded]="open" aria-label="Choose an icon">
      <svg [lucideIcon]="shown" [size]="18"></svg>
    </button>
    @if (open) {
      <div class="icon-picker__panel" (click)="$event.stopPropagation()">
        <input [(ngModel)]="query" placeholder="Search Lucide icons" aria-label="Search Lucide icons" />
        <div class="icon-picker__grid">
          @for (icon of filtered; track icon.name) {
            <button type="button" class="icon-picker__choice" [class.is-selected]="icon.name === shown" (click)="choose(icon.name)" [attr.aria-label]="icon.name">
              <svg [lucideIcon]="icon.name" [size]="18"></svg>
              <span>{{ icon.name }}</span>
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: block; }
    .icon-picker__current, .icon-picker__choice {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(84, 74, 64, 0.16);
      background: #fff;
      color: #375534;
    }
    .icon-picker__current {
      width: 36px;
      height: 36px;
      border-radius: 8px;
    }
    .icon-picker__panel {
      position: absolute;
      z-index: 5;
      top: 42px;
      left: 0;
      width: 280px;
      padding: 10px;
      border: 1px solid rgba(84, 74, 64, 0.14);
      border-radius: 12px;
      background: #fffdf9;
      box-shadow: 0 12px 30px rgba(26, 26, 26, 0.12);
    }
    input {
      width: 100%;
      min-height: 36px;
      margin-bottom: 8px;
      padding: 6px 10px;
      border: 1px solid rgba(84, 74, 64, 0.18);
      border-radius: 8px;
    }
    .icon-picker__grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      max-height: 220px;
      overflow: auto;
    }
    .icon-picker__choice {
      justify-content: flex-start;
      gap: 6px;
      min-height: 32px;
      padding: 4px 6px;
      border-radius: 8px;
      font-size: 11px;
    }
    .icon-picker__choice.is-selected { background: #e7f0dc; }
    svg { display: block; flex: none; fill: none; stroke: currentColor; }
  `]
})
export class LucideIconPickerComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  open = false;
  query = '';
  readonly icons = QUIZ_LUCIDE_ICONS.map((entry) => ({
    name: entry.icon.name,
    aliases: entry.icon.aliases || []
  }));

  get shown(): string {
    return quizIconName(this.value);
  }

  get filtered() {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.icons;
    return this.icons.filter((icon) => icon.name.includes(query) || icon.aliases.some((alias) => alias.includes(query)));
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.open = !this.open;
  }

  choose(name: string): void {
    this.value = name;
    this.valueChange.emit(name);
    this.open = false;
  }

  @HostListener('document:click', ['$event'])
  closeOnOutside(event: MouseEvent): void {
    if (!this.open) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open = false;
  }
}
