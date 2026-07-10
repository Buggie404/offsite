import { Directive, ElementRef, HostBinding, HostListener, inject } from '@angular/core';

@Directive({
  selector: '[appDragScroll]',
  standalone: true,
})
export class DragScrollDirective {
  @HostBinding('class.drag-scroll') readonly dragScrollClass = true;
  @HostBinding('class.is-dragging') isDragging = false;

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private startX = 0;
  private startScrollLeft = 0;
  private isPointerDown = false;
  private activePointerId: number | null = null;
  private readonly dragThreshold = 5;
  private wasDragging = false;

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

  @HostListener('pointermove', ['$event'])
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

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
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

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (this.wasDragging) {
      event.preventDefault();
      event.stopPropagation();
      this.wasDragging = false;
    }
  }
}
