import { Directive, ElementRef, HostBinding, HostListener, OnDestroy, inject } from '@angular/core';

@Directive({
  selector: '[appDragScroll]',
  standalone: true,
})
export class DragScrollDirective implements OnDestroy {
  @HostBinding('class.drag-scroll') readonly dragScrollClass = true;
  @HostBinding('class.is-dragging') isDragging = false;

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly suppressClickAfterDrag = (event: MouseEvent) => {
    if (!this.wasDragging) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.wasDragging = false;
  };
  private startX = 0;
  private startScrollLeft = 0;
  private isPointerDown = false;
  private activePointerId: number | null = null;
  private readonly dragThreshold = 5;
  private wasDragging = false;

  constructor() {
    this.element.addEventListener('click', this.suppressClickAfterDrag, true);
  }

  ngOnDestroy(): void {
    this.element.removeEventListener('click', this.suppressClickAfterDrag, true);
  }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;

    // Do not prevent the initial pointer event: buttons inside a horizontal
    // scroller must remain clickable. Drag mode starts only after movement.
    this.isPointerDown = true;
    this.activePointerId = event.pointerId;
    this.isDragging = false;
    this.startX = event.clientX;
    this.startScrollLeft = this.element.scrollLeft;
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.isPointerDown || event.pointerId !== this.activePointerId) return;

    const distance = event.clientX - this.startX;
    if (!this.isDragging && Math.abs(distance) < this.dragThreshold) return;

    if (!this.isDragging) {
      this.isDragging = true;
      this.element.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    this.element.scrollLeft = this.startScrollLeft - distance;
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  onPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;

    const wasDragging = this.isDragging;
    this.isPointerDown = false;
    this.activePointerId = null;
    this.isDragging = false;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }

    if (wasDragging) {
      this.wasDragging = true;
      setTimeout(() => {
        this.wasDragging = false;
      }, 0);
    }
  }

  @HostListener('pointerleave')
  onPointerLeave(): void {
    if (this.isDragging) return;
    this.isPointerDown = false;
    this.activePointerId = null;
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.element.scrollWidth <= this.element.clientWidth) return;

    const step = Math.max(80, Math.round(this.element.clientWidth * 0.65));
    let left: number | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        left = this.element.scrollLeft - step;
        break;
      case 'ArrowRight':
        left = this.element.scrollLeft + step;
        break;
      case 'Home':
        left = 0;
        break;
      case 'End':
        left = this.element.scrollWidth;
        break;
    }

    if (left === null) return;

    event.preventDefault();
    this.element.scrollTo({ left, behavior: 'smooth' });
  }
}
