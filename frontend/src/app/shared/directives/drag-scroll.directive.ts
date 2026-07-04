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

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;

    event.preventDefault();
    this.isDragging = true;
    this.startX = event.clientX;
    this.startScrollLeft = this.element.scrollLeft;
    this.element.setPointerCapture(event.pointerId);
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.element.scrollLeft = this.startScrollLeft - (event.clientX - this.startX);
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  onPointerEnd(event: PointerEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  }
}
