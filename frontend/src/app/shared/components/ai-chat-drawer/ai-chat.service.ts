import { Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth.service';
import { ChatMessage, ChatMessageOrder, ChatSupportAction } from './ai-chat.types';

@Injectable({
  providedIn: 'root'
})
export class AiChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // Toggle states
  readonly isOpen = signal<boolean>(false);
  readonly isBannerDismissed = signal<boolean>(false);
  readonly isTyping = signal<boolean>(false);
  // True after the shopper hits the daily message cap. The composer stays closed.
  readonly composerLocked = signal<boolean>(false);
  readonly conversationId = signal<string>('');
  readonly sessionId = signal<string>(this.newSessionId());
  readonly orderCodeDraft = signal('');
  readonly orderContactDraft = signal('');
  // Drops replies from the previous identity after login or logout.
  private requestEpoch = 0;
  private seenAuth: boolean | null = null;

  readonly messages = signal<ChatMessage[]>([this.welcomeMessage()]);

  constructor() {
    effect(() => {
      const authed = this.auth.isAuthenticated();
      if (this.seenAuth === null) {
        this.seenAuth = authed;
        return;
      }
      if (this.seenAuth === authed) return;
      this.seenAuth = authed;
      this.resetSession();
    });
    this.fetchInitParams();
  }

  /** Fresh concierge thread. Login and logout both start over so order context matches the account. */
  resetSession(): void {
    this.requestEpoch += 1;
    this.sessionId.set(this.newSessionId());
    this.conversationId.set('');
    this.orderCodeDraft.set('');
    this.orderContactDraft.set('');
    this.isTyping.set(false);
    this.composerLocked.set(false);
    this.messages.set([this.welcomeMessage()]);
    this.fetchInitParams();
  }

  private newSessionId(): string {
    return 'SS_' + Math.random().toString(36).substring(2, 9);
  }

  private welcomeMessage(): ChatMessage {
    return {
      id: 'm1',
      sender: 'ai',
      text: "Hi, I'm the Offsite Assistant. Welcome to Offsite - your café, at home.\nI can help you discover matcha and coffee, find brewing tools, learn brewing recipes, track your orders, and answer questions about our policies.\nWhat can I help you with today?",
      formattedHtml: "Hi, I'm the Offsite Assistant. Welcome to Offsite - your café, at home.<br>I can help you discover matcha and coffee, find brewing tools, learn brewing recipes, track your orders, and answer questions about our policies.<br>What can I help you with today?",
      timestamp: new Date(),
      quickReplies: [
        'Recommend a matcha for me',
        'Help me choose brewing tools',
        'Track my order',
        'What is your return policy?'
      ]
    };
  }

  fetchInitParams(): void {
    const epoch = this.requestEpoch;
    this.http.get<any>(`${environment.apiUrl}/ai-chat/init`).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch) return;
        if (res.opening_statement || res.suggested_questions) {
          const formatted = this.formatMarkdown(res.opening_statement || '');
          this.messages.update(msgs => {
            if (msgs.length === 1 && msgs[0].id === 'm1') {
              return [{
                ...msgs[0],
                text: res.opening_statement,
                formattedHtml: formatted,
                quickReplies: res.suggested_questions?.length ? res.suggested_questions : msgs[0].quickReplies
              }];
            }
            return msgs;
          });
        }
      },
      error: () => {}
    });
  }

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    this.isOpen.update(v => !v);
  }

  dismissBanner(): void {
    this.isBannerDismissed.set(true);
  }

  sendMessage(text: string): boolean {
    if (this.composerLocked()) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    if (trimmed.length > 500) {
      this.pushAssistantText('Message exceeds the 500-character limit. Please shorten your question.');
      return false;
    }

    const handoverReason = this.handoverReason(trimmed);
    if (handoverReason) {
      this.pushUserMessage(trimmed);
      this.requestHandover(handoverReason, trimmed);
      return true;
    }

    const orderDetails = this.extractOrderDetails(trimmed);
    this.rememberOrderDraft(orderDetails);

    const userMsg: ChatMessage = {
      id: 'user-' + Date.now(),
      sender: 'user',
      text: trimmed,
      timestamp: new Date()
    };

    this.messages.update(msgs => [...msgs, userMsg]);
    this.isTyping.set(true);

    const epoch = this.requestEpoch;
    const payload = {
      message: trimmed,
      session_id: this.sessionId(),
      conversation_id: this.conversationId()
    };

    this.http.post<any>(`${environment.apiUrl}/ai-chat/message`, payload).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch) return;
        this.isTyping.set(false);
        if (res.conversation_id) {
          this.conversationId.set(res.conversation_id);
        }

        const scope = res.handover ? null : this.orderSupportScope(trimmed);
        const priorAnnounced = this.messages().some(msg =>
          msg.sender === 'system' || this.alreadyToldTeam(msg.text || '')
        );
        const rawText = this.dedupeTeamCloser(
          res.reply || '',
          { priorAnnounced, willShowBanner: !!res.handover }
        );
        const formatted = this.formatMarkdown(rawText);
        const products = (res.products?.length ? res.products : (res.productCard ? [res.productCard] : [])).slice(0, 3);

        const accountOrders = Array.isArray(res.orders) ? res.orders.map((order: any) => this.toOrderCard(order)) : [];
        const hasBody = !!(rawText || products.length || res.orderCard || res.showOrderForm || accountOrders.length);
        if (!hasBody && !res.handover && !res.show_contact_form) {
          this.pushAssistantText('Our assistant is unavailable right now. Please try again in a moment.');
        } else if (hasBody) {
          const aiReply: ChatMessage = {
            id: 'ai-' + Date.now(),
            sender: 'ai',
            text: rawText,
            formattedHtml: formatted,
            timestamp: new Date(),
            products: products.length ? products : undefined,
            productCard: products[0],
            orderCard: res.orderCard,
            orderCards: accountOrders.length ? accountOrders : undefined,
            showOrderForm: res.showOrderForm,
            orderForm: res.showOrderForm
              ? { code: this.orderCodeDraft(), contact: this.orderContactDraft() }
              : undefined,
            supportActions: scope ? this.supportActionsFor(scope, trimmed, orderDetails.code) : undefined
          };
          this.messages.update(msgs => [...msgs, aiReply]);
        }

        if (res.show_contact_form) {
          this.pushUnavailableForm({
            message: res.message,
            hotline: res.hotline,
            faq_url: res.faq_url
          });
        } else if (res.handover) {
          this.pushHandoffBanner();
        }
      },
      error: (err) => {
        if (epoch !== this.requestEpoch) return;
        this.isTyping.set(false);
        const body = err?.error && typeof err.error === 'object' ? err.error : {};
        const status = body.status || '';

        // Dify quota / 429 / llm_error / out of tokens: tell the shopper to retry.
        // The contact form only comes back after more than two of these failures.
        if (status === 'daily_limit' || body.disable_composer === true) {
          this.composerLocked.set(true);
          this.pushUnavailableForm(body);
          return;
        }

        const failureText = `${status} ${body.code || ''} ${body.message || ''}`.toLowerCase();
        const providerLimited = status === 'temporarily_unavailable'
          || status === 'rate_limited'
          || /429|llm_error|out of tokens?|rate[\s_-]?limit|quota/.test(failureText);
        if (providerLimited && body.show_contact_form !== true) {
          this.pushAssistantText(body.message || 'Our assistant is unavailable right now. Please try again in a moment.');
          return;
        }

        const showForm = body.show_contact_form === true
          || status === 'budget_exceeded'
          || status === 'error'
          || err?.status === 0
          || err?.status === 503;

        if (showForm) {
          this.pushUnavailableForm(body);
          return;
        }

        const text = body.message || body.reply || 'Something went wrong. Please try again in a moment.';
        this.pushAssistantText(text);
      }
    });

    return true;
  }

  requestHandover(reason = 'user_request', message = ''): void {
    const epoch = this.requestEpoch;
    this.http.post<any>(`${environment.apiUrl}/ai-chat/handover`, {
      reason,
      message,
      session_id: this.sessionId(),
      conversation_id: this.conversationId()
    }).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch) return;
        if (res?.show_contact_form) {
          this.pushUnavailableForm(res);
          return;
        }
        this.pushHandoffBanner();
      },
      error: (err) => {
        if (epoch !== this.requestEpoch) return;
        const body = err?.error && typeof err.error === 'object' ? err.error : {};
        this.pushAssistantText(body.message || 'Could not connect you to the team. Please try again.');
      }
    });
  }

  leaveMessage(email: string, message: string) {
    return this.http.post<{ success: boolean; message?: string }>(
      `${environment.apiUrl}/ai-chat/leave-message`,
      {
        email,
        message,
        session_id: this.sessionId(),
        conversation_id: this.conversationId()
      }
    );
  }

  markContactSubmitted(messageId: string): void {
    this.messages.update(msgs => msgs.map(msg => (
      msg.id === messageId ? { ...msg, contactSubmitted: true } : msg
    )));
  }

  private pushUserMessage(text: string): void {
    this.messages.update(msgs => [...msgs, {
      id: 'user-' + Date.now(),
      sender: 'user',
      text,
      timestamp: new Date()
    }]);
  }

  /**
   * Guest order form. Looks the order up directly and replaces the form
   * with the result, without posting another shopper message.
   */
  lookupOrderFromForm(messageId: string): void {
    if (this.composerLocked() || this.isTyping()) return;
    const source = this.messages().find(msg => msg.id === messageId);
    const code = (source?.orderForm?.code || '').trim();
    const contact = (source?.orderForm?.contact || '').trim();
    if (!code || !contact) return;

    this.rememberOrderDraft({ code, contact });
    this.isTyping.set(true);
    const epoch = this.requestEpoch;
    const params = new URLSearchParams({ order_id: code, contact });

    this.http.get<any>(`${environment.apiUrl}/ai-chat/order-status?${params}`).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch) return;
        this.isTyping.set(false);
        const order = res?.order;
        if (!order) {
          this.setOrderFormFeedback(messageId, 'No matching order found. Check the order code and the phone or email used at checkout.');
          return;
        }
        this.showOrderOnForm(messageId, order, contact, code);
      },
      error: (err) => {
        if (epoch !== this.requestEpoch) return;
        this.isTyping.set(false);
        this.setOrderFormFeedback(messageId, this.orderLookupError(err));
      }
    });
  }

  private setOrderFormFeedback(messageId: string, text: string): void {
    this.messages.update(msgs => msgs.map(msg => (
      msg.id === messageId ? { ...msg, text, showOrderForm: true } : msg
    )));
  }

  private showOrderOnForm(messageId: string, order: any, contact: string, code: string): void {
    const card = this.toOrderCard(order, contact, code);
    const text = 'Here is that order:';
    this.messages.update(msgs => msgs.map(msg => (
      msg.id === messageId
        ? {
            ...msg,
            text,
            formattedHtml: text,
            showOrderForm: false,
            orderForm: undefined,
            orderCard: card
          }
        : msg
    )));
  }

  private orderLookupError(err: any): string {
    const body = err?.error && typeof err.error === 'object' ? err.error : {};
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (err?.status === 429) return 'You can look up 3 orders per hour. Please try again later.';
    return 'No matching order found. Check the order code and the phone or email used at checkout.';
  }

  updateOrderForm(messageId: string, field: 'code' | 'contact', value: string): void {
    if (field === 'code') this.orderCodeDraft.set(value);
    else this.orderContactDraft.set(value);
    this.messages.update(msgs => msgs.map(msg => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        orderForm: {
          code: field === 'code' ? value : (msg.orderForm?.code || ''),
          contact: field === 'contact' ? value : (msg.orderForm?.contact || '')
        }
      };
    }));
  }

  private rememberOrderDraft(details: { code: string; contact: string }): void {
    if (details.code) this.orderCodeDraft.set(details.code);
    if (details.contact) this.orderContactDraft.set(details.contact);
  }

  private orderSupportScope(text: string): 'cancel_edit' | 'address' | 'refund' | 'payment' | null {
    if (this.isPolicyQuestion(text)) return null;
    if (/thanh toán|thanh toan|payment failed|pay(?:ment)? (?:error|issue|problem)|charged twice|double charg|paid but|chưa nhận được tiền|chua nhan duoc tien|bị trừ|bi tru/i.test(text)) {
      return 'payment';
    }
    if (/duyệt hoàn|duyet hoan|hoàn tiền|hoan tien|approve (?:my |the )?refund|refund (?:request|status|pending)|return (?:my |this )?order/i.test(text)) {
      return 'refund';
    }
    if (/đổi địa chỉ|doi dia chi|sửa địa chỉ|sua dia chi|sai địa chỉ|sai dia chi|change (?:my |the )?(?:address|delivery)|wrong address|update (?:my )?address/i.test(text)) {
      return 'address';
    }
    if (/hủy|huy\b|sửa đơn|sua don|cancel|cancell?ation|edit (?:my )?order|modify (?:my )?order|change (?:my |the )?order|reschedule/i.test(text)) {
      return 'cancel_edit';
    }
    return null;
  }

  private isPolicyQuestion(text: string): boolean {
    return /return policy|refund policy|payment methods|chính sách|chinh sach|what is your|how (?:do|can) (?:i|we) pay|cách thanh toán|cach thanh toan/i.test(text);
  }

  private supportActionsFor(
    scope: 'cancel_edit' | 'address' | 'refund' | 'payment',
    summary: string,
    orderId: string
  ): ChatSupportAction[] {
    const page: ChatSupportAction = scope === 'refund'
      ? { kind: 'refund', label: 'Refund request', orderId }
      : { kind: 'tracking', label: 'Order tracking', orderId };
    return [
      {
        kind: 'cskh',
        label: 'Talk to admin',
        handoverReason: scope === 'refund' ? 'refund' : scope === 'payment' ? 'complaint' : 'order_change',
        summary
      },
      page
    ];
  }

  private extractOrderDetails(text: string): { code: string; contact: string } {
    const codeMatch = text.match(/OFS-\d{4}-\d{5,}/i);
    const code = codeMatch ? codeMatch[0].toUpperCase() : '';
    const rest = codeMatch ? text.replace(codeMatch[0], ' ') : text;
    const email = rest.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) return { code, contact: email[0] };
    const phone = rest.match(/(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/);
    return { code, contact: phone ? phone[0].replace(/[^\d+]/g, '') : '' };
  }

  private isHaltedStatus(status: string): boolean {
    const key = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ['canceled', 'cancelled', 'refund', 'pending_refund', 'refund_rejected'].includes(key);
  }

  private formatEstimate(value: unknown, status = ''): string {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw || /track order/i.test(raw)) return '';
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return status.toLowerCase().includes('deliver') ? `Delivered ${formatted}` : `Expected ${formatted}`;
    }
    return raw;
  }

  private alreadyToldTeam(text: string): boolean {
    return /I(?:'ll| will| am|'m)\s+connect(?:ing)? you with (?:our |the )?team/i.test(text)
      || /(?:have |'ve )?(?:sent|forwarded|passed) (?:your |the |this )?(?:message|request|case) to (?:the |our )?(?:team|admin)/i.test(text)
      || /that message was (?:sent|forwarded) to the team/i.test(text)
      || /đang kết nối bạn|đã (?:gửi|chuyển).{0,50}(?:admin|nhân viên|đội ngũ|team)/i.test(text);
  }

  private dedupeTeamCloser(
    text: string,
    options: { priorAnnounced?: boolean; willShowBanner?: boolean } = {}
  ): string {
    const raw = String(text || '').trim();
    const rider = "(?:They(?:'ll| will) see our conversation,?\\s*so you (?:won(?:'t|t)|will not) need to repeat yourself\\.?)?";
    const closer = "I(?:'m| am) connecting you with our team(?: right)? now\\.?\\s*" + rider;
    const embedded = raw.match(new RegExp('\\n+\\s*(' + closer + ')\\s*$', 'i'));
    const only = new RegExp('^' + closer + '$', 'i').test(raw);
    if (!embedded && !only) return raw;

    const head = embedded && embedded.index != null ? raw.slice(0, embedded.index).trim() : '';
    const priorAnnounced = !!options.priorAnnounced;
    if (this.alreadyToldTeam(head) || (priorAnnounced && (head || options.willShowBanner))) return head;
    return raw;
  }

  private pushHandoffBanner(): void {
    this.messages.update(msgs => [...msgs, {
      id: 'sys-' + Date.now(),
      sender: 'system',
      text: 'That message was sent to the team. You can keep chatting with the assistant.',
      timestamp: new Date()
    }]);
  }

  private toOrderCard(order: any, contact = '', fallbackCode = ''): ChatMessageOrder {
    const status = String(order.order_status || 'processing');
    const stepIndex = ['pending', 'processing', 'shipping', 'delivered'].indexOf(status.toLowerCase());
    const orderId = String(order.order_id || fallbackCode).replace(/^#/, '');
    const items = Array.isArray(order.items)
      ? order.items
        .map((item: any) => ({
          name: String(item.name || item.product_name || '').trim(),
          quantity: Number(item.quantity) || 1
        }))
        .filter((item: { name: string }) => !!item.name)
      : [];
    return {
      code: orderId ? `#${orderId}` : '',
      orderId,
      contact: contact || undefined,
      status,
      progressPercent: stepIndex >= 0 ? Math.round(((stepIndex + 1) / 4) * 100) : 0,
      expectedDate: this.isHaltedStatus(status) ? '' : this.formatEstimate(order.estimated_delivery, status),
      city: order.city || '',
      items,
      total: Number(order.total_amount ?? order.total ?? 0),
      currency: order.currency || 'USD'
    };
  }

  private handoverReason(text: string): string | null {
    if (/talk to (?:a )?(?:person|human|someone|agent)|speak to (?:a )?(?:person|human|agent)|real person|nhân viên|customer service|\bcskh\b/i.test(text)) {
      return 'user_request';
    }
    return null;
  }

  private pushAssistantText(text: string): void {
    const current = this.messages();
    const last = current[current.length - 1];
    if (last?.sender === 'ai' && last.text === text && !last.showContactForm) return;

    this.messages.update(msgs => [...msgs, {
      id: 'err-' + Date.now(),
      sender: 'ai',
      text,
      timestamp: new Date()
    }]);
  }

  private pushUnavailableForm(body: { hotline?: string; faq_url?: string; message?: string }): void {
    const alreadyOpen = this.messages().some(msg => msg.showContactForm && !msg.contactSubmitted);
    if (alreadyOpen) return;

    this.messages.update(msgs => [...msgs, {
      id: 'err-' + Date.now(),
      sender: 'ai',
      text: '',
      timestamp: new Date(),
      showContactForm: true,
      contactCard: {
        title: body.message || 'Our assistant is unavailable right now. Leave a message and we will reply by email.',
        hotline: body.hotline || '1900 0000',
        faqUrl: body.faq_url || '/contact-us#faq'
      }
    }]);
  }

  /**
   * Helper to format markdown bolding **text** to <strong>text</strong>, numbered lists, and line breaks
   */
  formatMarkdown(text: string): string {
    if (!text) return '';
    return text
      // Convert markdown bold **text** to <strong>
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Convert markdown italic *text* or _text_ to <em>
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Convert numbered lists like " 1. " or " 2. " to nice line breaks with numbers
      .replace(/(\s)(\d+\.)\s+/g, '<br><strong class="num-bullet">$2</strong> ')
      // Convert standard linebreaks
      .replace(/\n\n+/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }
}
