import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  effect,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  LucideMessageCircle,
  LucideSparkles,
  LucideX,
  LucideMinus,
  LucideSend,
  LucideHeadphones,
  LucideUser,
  LucidePhoneCall,
  LucideHelpCircle,
  LucideArrowRight,
  LucideAlertTriangle
} from '@lucide/angular';
import { AiChatService } from './ai-chat.service';
import { CartService } from '../../../features/purchase/services/cart.service';
import { ToastService } from '../../services/toast.service';
import { ChatMessage, ChatMessageOrder, ChatMessageProduct, ChatSupportAction } from './ai-chat.types';

@Component({
  selector: 'app-ai-chat-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucideMessageCircle,
    LucideSparkles,
    LucideX,
    LucideMinus,
    LucideSend,
    LucideHeadphones,
    LucideUser,
    LucidePhoneCall,
    LucideHelpCircle,
    LucideArrowRight,
    LucideAlertTriangle
  ],
  templateUrl: './ai-chat-drawer.component.html',
  styleUrls: ['./ai-chat-drawer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiChatDrawerComponent {
  protected readonly chatService = inject(AiChatService);
  private readonly cartService = inject(CartService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;

  inputText = '';

  // Leave a message form state
  contactEmail = '';
  contactMessage = '';
  contactEmailError = '';
  contactMessageError = '';
  isSendingContact = false;

  constructor() {
    // Auto scroll to bottom when messages or typing changes
    effect(() => {
      this.chatService.messages();
      this.chatService.isTyping();
      this.chatService.isOpen();
      setTimeout(() => this.scrollToBottom(), 50);
    });

    effect(() => {
      this.chatService.sessionId();
      this.inputText = '';
      this.contactEmail = '';
      this.contactMessage = '';
      this.contactEmailError = '';
      this.contactMessageError = '';
      this.isSendingContact = false;
    });
  }

  toggleChat(): void {
    this.chatService.toggle();
  }

  closeChat(): void {
    this.chatService.close();
  }

  dismissBanner(event: MouseEvent): void {
    event.stopPropagation();
    this.chatService.dismissBanner();
  }

  handleSend(): void {
    if (this.chatService.composerLocked() || !this.inputText.trim() || this.chatService.isTyping()) return;
    const sent = this.chatService.sendMessage(this.inputText);
    if (sent) this.inputText = '';
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  selectQuickReply(reply: string): void {
    if (this.chatService.composerLocked()) return;
    this.chatService.sendMessage(reply);
  }

  onSupportAction(action: ChatSupportAction): void {
    if (action.kind === 'cskh') {
      this.chatService.requestHandover(action.handoverReason || 'order_change', action.summary || '');
      return;
    }

    const orderId = (action.orderId || '').trim();
    this.router.navigate(['/order-tracking'], {
      queryParams: orderId ? { orderId } : {}
    });
    this.chatService.close();
  }

  talkToPerson(): void {
    this.chatService.requestHandover('user_request');
  }

  submitOrderLookup(msg: ChatMessage): void {
    this.chatService.lookupOrderFromForm(msg.id);
  }

  onAddToCart(prod: ChatMessageProduct, event: MouseEvent): void {
    event.stopPropagation();
    if (prod.inStock === false) return;
    if (prod.rawProduct) {
      this.cartService.addToCart(prod.rawProduct, prod.defaultSku, 1, true);
      this.toastService.success(`Added "${prod.name}" to cart`);
      this.chatService.close();
    } else {
      this.toastService.show(`Viewing product "${prod.name}"`);
      this.goToProduct(prod);
    }
  }

  goToProduct(prod: ChatMessageProduct): void {
    if (prod.slug) {
      this.router.navigate(['/products', prod.slug]);
      this.chatService.close();
    }
  }

  navigateToContact(url: string = '/contact-us'): void {
    this.router.navigateByUrl(url);
    this.chatService.close();
  }

  orderEstimate(order: ChatMessageOrder): string {
    if (this.isHaltedOrder(order.status)) return '';
    return (order.expectedDate || '').replace(/\s*·\s*Track order.*$/i, '').trim();
  }

  openOrderTracking(order: ChatMessageOrder): void {
    const orderId = (order.orderId || order.code || '').replace(/^#/, '').trim();
    const contact = (order.contact || '').trim();
    this.router.navigate(['/order-tracking'], {
      queryParams: orderId ? { orderId } : {},
      state: contact ? { contact } : {}
    });
    this.chatService.close();
  }

  orderStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pending',
      processing: 'Processing',
      shipping: 'Shipping',
      delivery_failed: 'Delivery failed',
      delivered: 'Delivered',
      canceled: 'Canceled',
      cancelled: 'Canceled',
      refund: 'Refunded',
      pending_refund: 'Pending refund',
      refund_rejected: 'Refund rejected'
    };
    const key = this.orderStatusKey(status);
    return labels[key] || status || 'Processing';
  }

  orderBadgeClass(status: string): string {
    const key = this.orderStatusKey(status);
    if (key === 'delivered') return 'order-badge--done';
    if (key === 'shipping') return 'order-badge--shipping';
    if (this.isHaltedOrder(status)) return 'order-badge--halted';
    return 'order-badge--active';
  }

  isHaltedOrder(status: string): boolean {
    return ['canceled', 'cancelled', 'refund', 'pending_refund', 'refund_rejected'].includes(this.orderStatusKey(status));
  }

  orderSteps(status: string): { label: string; done: boolean; current: boolean }[] {
    const flow = [
      { key: 'pending', label: 'Pending' },
      { key: 'processing', label: 'Processing' },
      { key: 'shipping', label: 'Shipping' },
      { key: 'delivered', label: 'Delivered' }
    ];
    const index = flow.findIndex(step => step.key === this.orderStatusKey(status));
    const currentIndex = index >= 0 ? index : 0;
    return flow.map((step, i) => ({
      label: step.label,
      done: i <= currentIndex,
      current: i === currentIndex
    }));
  }

  private orderStatusKey(status: string): string {
    return (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  hotlineLabel(msg: ChatMessage): string {
    return msg.contactCard?.hotline || '1900 0000';
  }

  hotlineDigits(msg: ChatMessage): string {
    return this.hotlineLabel(msg).replace(/[^\d+]/g, '');
  }

  openFaq(event: MouseEvent, msg: ChatMessage): void {
    event.preventDefault();
    const raw = msg.contactCard?.faqUrl || '/contact-us#faq';
    const [path, fragment] = raw.split('#');
    this.router.navigate([path || '/contact-us'], { fragment: fragment || 'faq' });
    this.chatService.close();
  }

  submitContactForm(msg: ChatMessage): void {
    if (this.isSendingContact || msg.contactSubmitted) return;

    const email = this.contactEmail.trim();
    const text = this.contactMessage.trim();
    this.contactEmailError = '';
    this.contactMessageError = '';

    if (!email) {
      this.contactEmailError = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.contactEmailError = 'Enter a valid email address.';
    }

    if (!text) {
      this.contactMessageError = 'Message is required.';
    }

    if (this.contactEmailError || this.contactMessageError) return;

    this.isSendingContact = true;
    this.chatService.leaveMessage(email, text).subscribe({
      next: () => {
        this.isSendingContact = false;
        this.chatService.markContactSubmitted(msg.id);
        this.contactEmail = '';
        this.contactMessage = '';
      },
      error: (err) => {
        this.isSendingContact = false;
        const body = err?.error && typeof err.error === 'object' ? err.error : {};
        const message = body.message || 'Could not send your message. Please try again.';
        if (body.field === 'email') {
          this.contactEmailError = message;
        } else {
          this.contactMessageError = message;
        }
      }
    });
  }

  private scrollToBottom(): void {
    const el = this.messagesContainer?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
}
