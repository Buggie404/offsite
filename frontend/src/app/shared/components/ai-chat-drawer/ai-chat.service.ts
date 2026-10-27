import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, exhaustMap, filter, interval, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth.service';
import { ChatDecision, ChatHistoryItem, ChatInteraction, ChatMessage, ChatMessageOrder, ChatSupportAction } from './ai-chat.types';

@Injectable({
  providedIn: 'root'
})
export class AiChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'offsite.aiChat.sessionId';
  private readonly initStorageKey = 'offsite.aiChat.init';

  // Toggle states
  readonly isOpen = signal<boolean>(false);
  readonly isBannerDismissed = signal<boolean>(false);
  readonly isTyping = signal<boolean>(false);
  // True after the shopper hits the daily message cap. The composer stays closed.
  readonly composerLocked = signal<boolean>(false);
  readonly conversationId = signal<string>('');
  readonly humanChatActive = signal(false);
  readonly sessionId = signal<string>('');
  readonly interaction = signal<ChatInteraction>('ready');
  readonly historyOpen = signal(false);
  readonly history = signal<ChatHistoryItem[]>([]);
  readonly historyCursor = signal<string | null>(null);
  readonly draftToken = signal(0);
  readonly draftText = signal('');
  readonly orderCodeDraft = signal('');
  readonly orderContactDraft = signal('');
  readonly canUseHistory = computed(() => this.auth.isAuthenticated());
  readonly composerBlocked = computed(() => this.composerLocked() || this.interaction() !== 'ready');
  // Drops replies from the previous identity after login or logout.
  private requestEpoch = 0;
  private viewToken = 0;
  private seenAuth: boolean | null = null;
  private openedFromHistory = false;
  private openingSession = false;
  private initInFlight = false;
  private initCache: { statement: string; questions: string[] } | null = null;
  private currentDecision = signal<ChatDecision>('continue');

  readonly messages = signal<ChatMessage[]>([]);

  constructor() {
    this.initCache = this.readInitCache();
    this.sessionId.set(this.readStoredSessionId());
    effect(() => {
      const authed = this.auth.isAuthenticated();
      if (this.seenAuth === null) {
        this.seenAuth = authed;
        return;
      }
      if (this.seenAuth === authed) return;
      const loggingIn = authed && this.seenAuth === false;
      this.seenAuth = authed;
      if (loggingIn) {
        const previousId = this.sessionId();
        this.storage()?.removeItem(this.storageKey);
        this.claimThenReset(previousId);
        return;
      }
      this.resetSession();
    });
    // Use the owned AI session endpoint for both signed-in customers and guests.
    interval(2500).pipe(
      filter(() => isPlatformBrowser(this.platformId) && this.isOpen() && this.humanChatActive() && !this.isTyping() && !this.openedFromHistory && !this.openingSession),
      exhaustMap(() => {
        const id = this.sessionId(), epoch = this.requestEpoch, view = this.viewToken;
        return this.http.get<any>(`${environment.apiUrl}/ai-chat/sessions/${id}`).pipe(
          map(res => ({ res, id, epoch, view })), catchError(() => EMPTY)
        );
      }),
      takeUntilDestroyed()
    ).subscribe(({ res, id, epoch, view }) => {
      if (id !== this.sessionId() || epoch !== this.requestEpoch || view !== this.viewToken || this.isTyping()) return;
      this.applyLoaded(res, 'current');
    });
  }

  /** Fresh concierge thread. Login and logout both start over so order context matches the account. */
  resetSession(): void {
    this.humanChatActive.set(false);
    this.requestEpoch += 1;
    this.viewToken += 1;
    this.storage()?.removeItem(this.storageKey);
    const id = this.newSessionId();
    this.storage()?.setItem(this.storageKey, id);
    this.sessionId.set(id);
    this.conversationId.set('');
    this.orderCodeDraft.set('');
    this.orderContactDraft.set('');
    this.isTyping.set(false);
    this.composerLocked.set(false);
    this.interaction.set('ready');
    this.currentDecision.set('continue');
    this.historyOpen.set(false);
    this.openedFromHistory = false;
    this.showWelcome();
    this.setDraft('');
  }

  private newSessionId(): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const rand = Math.random() * 16 | 0;
      const value = char === 'x' ? rand : ((rand & 0x3) | 0x8);
      return value.toString(16);
    });
  }

  private storage(): Storage | null {
    return isPlatformBrowser(this.platformId) ? localStorage : null;
  }

  private readStoredSessionId(): string {
    const existing = this.storage()?.getItem(this.storageKey)?.trim();
    if (existing) return existing;
    const id = this.newSessionId();
    this.storage()?.setItem(this.storageKey, id);
    return id;
  }

  private setDraft(text: string): void {
    this.draftText.set(text);
    this.draftToken.update(value => value + 1);
  }

  private claimThenReset(sessionId: string): void {
    const epoch = this.requestEpoch;
    this.interaction.set('loading');
    this.http.post(`${environment.apiUrl}/ai-chat/sessions/claim`, { session_id: sessionId }).subscribe({
      next: () => {
        if (epoch !== this.requestEpoch) return;
        this.resetSession();
      },
      error: () => {
        if (epoch !== this.requestEpoch) return;
        this.resetSession();
      }
    });
  }

  private showWelcome(): void {
    this.messages.set([this.welcomeMessage()]);
    this.fetchInitParams();
  }

  startNewChat(): void {
    if (this.openingSession) return;
    this.historyOpen.set(false);
    this.openedFromHistory = false;
    this.showWelcome();
    this.openNewSession('new_chat', false, null);
  }

  continueChat(): void {
    const id = this.sessionId();
    const epoch = this.requestEpoch;
    const view = this.viewToken;
    this.http.post<any>(`${environment.apiUrl}/ai-chat/sessions/${id}/resume`, {}).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        if (res?.decision === 'rotate') {
          this.currentDecision.set('rotate');
          if (this.openedFromHistory) this.interaction.set('readonly');
          else this.rotateLive(null);
          return;
        }
        this.currentDecision.set('continue');
        this.interaction.set('ready');
      },
      error: () => {
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        this.pushAssistantText('Could not continue this chat. Please try again.');
      }
    });
  }

  toggleHistory(): void {
    if (!this.canUseHistory()) return;
    const next = !this.historyOpen();
    this.historyOpen.set(next);
    if (next) this.loadHistory(true);
  }

  loadHistory(reset: boolean): void {
    if (!this.auth.isAuthenticated()) return;
    const params = new URLSearchParams({ limit: '20' });
    const cursor = this.historyCursor();
    if (!reset && cursor) params.set('cursor', cursor);
    this.http.get<any>(`${environment.apiUrl}/ai-chat/sessions?${params}`).subscribe({
      next: (res) => {
        const rows = Array.isArray(res?.sessions) ? res.sessions : [];
        this.history.update(current => reset ? rows : [...current, ...rows]);
        this.historyCursor.set(res?.next_cursor || null);
      },
      error: () => {
        if (reset) this.history.set([]);
        this.historyCursor.set(null);
      }
    });
  }

  openHistory(sessionId: string): void {
    this.openedFromHistory = true;
    this.historyOpen.set(false);
    this.storage()?.setItem(this.storageKey, sessionId);
    this.sessionId.set(sessionId);
    this.conversationId.set('');
    this.viewToken += 1;
    this.setDraft('');
    this.loadSession(sessionId, 'history');
  }

  deleteHistory(sessionId: string): void {
    this.http.delete(`${environment.apiUrl}/ai-chat/sessions/${sessionId}`).subscribe({
      next: () => {
        this.history.update(rows => rows.filter(row => row.session_id !== sessionId));
        if (this.sessionId() === sessionId) {
          this.openedFromHistory = false;
          this.currentDecision.set('continue');
          this.openNewSession('new_chat', false, null);
        }
      }
    });
  }

  /** Leave-a-message and other writes can also be asked to idle or rotate. */
  applyServerDecision(decision: string | undefined, draft = ''): boolean {
    if (decision === 'idle') {
      this.currentDecision.set('idle');
      this.interaction.set('idle');
      return true;
    }
    if (decision === 'rotate') {
      this.currentDecision.set('rotate');
      this.rotateLive(draft);
      return true;
    }
    return false;
  }

  private loadSession(id: string, source: 'current' | 'history'): void {
    const token = ++this.viewToken;
    const epoch = this.requestEpoch;
    this.interaction.set('loading');
    this.http.get<any>(`${environment.apiUrl}/ai-chat/sessions/${id}`).subscribe({
      next: (res) => {
        if (token !== this.viewToken || epoch !== this.requestEpoch || id !== this.sessionId()) return;
        this.applyLoaded(res, source);
      },
      error: (err) => {
        if (token !== this.viewToken || epoch !== this.requestEpoch || id !== this.sessionId()) return;
        if (err?.status === 404 && source === 'current') {
          this.currentDecision.set('continue');
          this.interaction.set('ready');
          this.showWelcome();
          return;
        }
        if (err?.status === 404) {
          this.messages.set([]);
          this.currentDecision.set('closed');
          this.interaction.set('readonly');
          return;
        }
        if (!this.messages().length) this.showWelcome();
        this.interaction.set('ready');
      }
    });
  }

  private applyLoaded(res: any, source: 'current' | 'history'): void {
    this.humanChatActive.set(!!res?.support_conversation_id && ['waiting', 'in_progress'].includes(res?.status));
    const decision: ChatDecision = res?.decision || 'continue';
    this.currentDecision.set(decision);
    if (decision === 'rotate' && source === 'current') {
      this.rotateLive(null);
      return;
    }

    const msgs = this.fromServerMessages(res?.messages || []);
    if (!msgs.length && decision === 'continue') {
      this.interaction.set('ready');
      this.showWelcome();
      return;
    }
    this.messages.set(msgs);
    if (decision === 'idle') {
      this.interaction.set('idle');
      return;
    }
    if (decision === 'rotate' || decision === 'closed') {
      this.interaction.set('readonly');
      return;
    }
    this.interaction.set('ready');
  }

  private rotateLive(draft: string | null): void {
    this.openNewSession('rotate', true, draft);
  }

  private openNewSession(
    reason: 'new_chat' | 'idle' | 'rotate',
    notice: boolean,
    draft: string | null
  ): void {
    const epoch = this.requestEpoch;
    const previous = this.sessionId();
    this.viewToken += 1;
    const view = this.viewToken;
    this.openingSession = true;
    this.interaction.set('loading');
    this.historyOpen.set(false);
    this.http.post<any>(`${environment.apiUrl}/ai-chat/sessions`, {
      session_id: previous,
      close_reason: reason,
      opening_notice: notice
    }).subscribe({
      next: (res) => {
        this.openingSession = false;
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        this.adoptSession(res?.session_id || this.newSessionId(), res?.messages || [], draft);
      },
      error: () => {
        this.openingSession = false;
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        this.interaction.set(reason === 'idle' ? 'idle' : reason === 'rotate' ? 'readonly' : 'ready');
        this.pushAssistantText('Could not start a new chat. Please try again.');
      }
    });
  }

  private adoptSession(id: string, serverMessages: any[], draft: string | null): void {
    this.humanChatActive.set(false);
    this.storage()?.setItem(this.storageKey, id);
    this.sessionId.set(id);
    this.conversationId.set('');
    this.openedFromHistory = false;
    this.currentDecision.set('continue');
    this.interaction.set('ready');
    this.composerLocked.set(false);
    this.isTyping.set(false);
    this.orderCodeDraft.set('');
    this.orderContactDraft.set('');
    const msgs = this.fromServerMessages(serverMessages);
    if (msgs.length) this.messages.set(msgs);
    else this.showWelcome();
    if (draft !== null) this.setDraft(draft);
  }

  private fromServerMessages(rows: any[]): ChatMessage[] {
    let lastUser = '';
    const mapped = (rows || []).map(row => {
      const sender = row?.sender || 'ai';
      const text = row?.text || '';
      if (sender === 'user') lastUser = text;
      const meta = row?.metadata || {};
      const products = Array.isArray(meta.products) ? meta.products : [];
      const orders = Array.isArray(meta.orders) ? meta.orders.map((order: any) => this.asOrderCard(order)) : [];
      const orderCard = meta.orderCard ? this.asOrderCard(meta.orderCard) : undefined;
      const showOrderForm = !!meta.showOrderForm && !orderCard;
      const showContact = !!meta.showContactForm;
      const scope = sender === 'ai' ? this.orderSupportScope(lastUser) : null;
      const details = scope ? this.extractOrderDetails(lastUser) : { code: '', contact: '' };
      const message: ChatMessage = {
        id: row?.message_id || ('m-' + Math.random().toString(36).slice(2)),
        sender,
        text,
        formattedHtml: sender === 'ai' && text ? this.formatMarkdown(text) : undefined,
        timestamp: row?.created_at ? new Date(row.created_at) : new Date(),
        noticeKind: meta.kind === 'status' ? 'status' : undefined,
        products: products.length ? products : undefined,
        productCard: products[0],
        orderCard,
        orderCards: orders.length ? orders : undefined,
        showOrderForm,
        orderForm: showOrderForm ? { code: '', contact: '' } : undefined,
        showContactForm: showContact,
        contactCard: showContact ? {
          hotline: '1900 0000',
          faqUrl: '/contact-us#faq'
        } : undefined,
        supportActions: scope ? this.supportActionsFor(scope, lastUser, details.code) : undefined
      };
      return message;
    });

    const leaveAt = mapped.findIndex(msg => msg.sender === 'user' && /^Leave a message \(/i.test(msg.text || ''));
    if (leaveAt > 0) {
      for (let index = 0; index < leaveAt; index += 1) {
        if (mapped[index].showContactForm) mapped[index] = { ...mapped[index], contactSubmitted: true };
      }
    }
    return mapped;
  }

  private asOrderCard(order: any): ChatMessageOrder {
    if (!order || typeof order !== 'object') {
      return { code: '', status: 'processing' };
    }
    if (order.order_id || order.order_status) {
      return this.toOrderCard(order, order.contact || '', order.order_id || '');
    }
    return {
      code: order.code || (order.orderId ? `#${order.orderId}` : ''),
      orderId: order.orderId,
      contact: order.contact,
      status: order.status || 'processing',
      progressPercent: order.progressPercent,
      expectedDate: order.expectedDate,
      city: order.city,
      items: order.items,
      total: order.total,
      currency: order.currency || 'USD'
    };
  }

  private rollbackMessage(id: string): void {
    this.messages.update(msgs => msgs.filter(msg => msg.id !== id));
  }

  private welcomeMessage(): ChatMessage {
    const statement = this.initCache?.statement?.trim() || '';
    const questions = (this.initCache?.questions || []).filter(question => question.trim());
    const text = statement || "Hi, I'm the Offsite Assistant. Welcome to Offsite - your café, at home.\nI can help you discover matcha and coffee, find brewing tools, learn brewing recipes, track your orders, and answer questions about our policies.\nWhat can I help you with today?";
    return {
      id: 'm1',
      sender: 'ai',
      text,
      formattedHtml: statement
        ? this.formatMarkdown(statement)
        : "Hi, I'm the Offsite Assistant. Welcome to Offsite - your café, at home.<br>I can help you discover matcha and coffee, find brewing tools, learn brewing recipes, track your orders, and answer questions about our policies.<br>What can I help you with today?",
      timestamp: new Date(),
      quickReplies: questions.length ? questions : [
        'Recommend a matcha for me',
        'Help me choose brewing tools',
        'Track my order',
        'What is your return policy?'
      ]
    };
  }

  fetchInitParams(): void {
    if (this.initCache || this.initInFlight || !isPlatformBrowser(this.platformId)) return;
    this.initInFlight = true;
    this.http.get<any>(`${environment.apiUrl}/ai-chat/init`).subscribe({
      next: (res) => {
        this.initInFlight = false;
        const statement = typeof res?.opening_statement === 'string' ? res.opening_statement.trim() : '';
        const questions = Array.isArray(res?.suggested_questions)
          ? res.suggested_questions.map((question: unknown) => String(question || '').trim()).filter(Boolean)
          : [];
        if (!statement && !questions.length) return;
        this.rememberInit(statement, questions);
        this.applyInitToWelcome();
      },
      error: () => {
        this.initInFlight = false;
      }
    });
  }

  private readInitCache(): { statement: string; questions: string[] } | null {
    try {
      const raw = this.storage()?.getItem(this.initStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const statement = typeof parsed?.statement === 'string' ? parsed.statement.trim() : '';
      const questions = Array.isArray(parsed?.questions)
        ? parsed.questions.map((question: unknown) => String(question || '').trim()).filter(Boolean)
        : [];
      if (!statement && !questions.length) return null;
      return { statement, questions };
    } catch {
      return null;
    }
  }

  private rememberInit(statement: string, questions: string[]): void {
    this.initCache = {
      statement: statement || this.initCache?.statement || '',
      questions: questions.length ? questions : (this.initCache?.questions || [])
    };
    try {
      this.storage()?.setItem(this.initStorageKey, JSON.stringify(this.initCache));
    } catch {
      // Ignore quota errors. The in-memory copy still makes the next New chat instant.
    }
  }

  private applyInitToWelcome(): void {
    const welcome = this.welcomeMessage();
    this.messages.update(msgs => {
      if (msgs.length === 1 && msgs[0].id === 'm1') return [welcome];
      return msgs;
    });
  }

  open(): void {
    this.isOpen.set(true);
    this.fetchInitParams();
    if (this.isTyping()) return;
    this.loadSession(this.sessionId(), this.openedFromHistory ? 'history' : 'current');
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
      return;
    }
    this.open();
  }

  dismissBanner(): void {
    this.isBannerDismissed.set(true);
  }

  sendMessage(text: string): boolean {
    if (this.composerBlocked()) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    if (trimmed.length > 500) {
      this.pushAssistantText('Message exceeds the 500-character limit. Please shorten your question.');
      return false;
    }

    const handoverReason = this.handoverReason(trimmed);
    if (handoverReason && !this.humanChatActive()) {
      const userMsg = this.pushUserMessage(trimmed);
      this.requestHandover(handoverReason, trimmed, { userMessageId: userMsg.id });
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
    const view = this.viewToken;
    const payload = {
      message: trimmed,
      session_id: this.sessionId(),
      conversation_id: this.conversationId()
    };

    this.http.post<any>(`${environment.apiUrl}/ai-chat/message`, payload).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        this.isTyping.set(false);
        if (res?.human_chat) {
          this.applyLoaded(res, 'current');
          return;
        }
        if (res?.decision === 'idle') {
          this.rollbackMessage(userMsg.id);
          this.currentDecision.set('idle');
          this.interaction.set('idle');
          this.setDraft(trimmed);
          return;
        }
        if (res?.decision === 'rotate') {
          this.rollbackMessage(userMsg.id);
          this.currentDecision.set('rotate');
          this.rotateLive(trimmed);
          return;
        }
        if (res.conversation_id) {
          this.conversationId.set(res.conversation_id);
        }
        if (res.user_message_id) {
          this.messages.update(msgs => msgs.map(msg => (
            msg.id === userMsg.id ? { ...msg, id: res.user_message_id } : msg
          )));
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
            id: res.assistant_message_id || ('ai-' + Date.now()),
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
        } else         if (res.handover) {
          this.pushHandoffBanner();
        }
      },
      error: (err) => {
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        this.isTyping.set(false);
        const body = err?.error && typeof err.error === 'object' ? err.error : {};
        const status = body.status || '';

        if (err?.status === 409 || status === 'closed') {
          this.rollbackMessage(userMsg.id);
          this.currentDecision.set('closed');
          this.interaction.set('readonly');
          return;
        }

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

  requestHandover(
    reason = 'user_request',
    message = '',
    hooks?: { userMessageId?: string }
  ): void {
    const epoch = this.requestEpoch;
    const view = this.viewToken;
    this.http.post<any>(`${environment.apiUrl}/ai-chat/handover`, {
      reason,
      message,
      session_id: this.sessionId(),
      conversation_id: this.conversationId()
    }).subscribe({
      next: (res) => {
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        if (res?.decision === 'idle') {
          if (hooks?.userMessageId) this.rollbackMessage(hooks.userMessageId);
          this.currentDecision.set('idle');
          this.interaction.set('idle');
          return;
        }
        if (res?.decision === 'rotate') {
          if (hooks?.userMessageId) this.rollbackMessage(hooks.userMessageId);
          this.currentDecision.set('rotate');
          this.rotateLive(null);
          return;
        }
        if (res?.show_contact_form) {
          this.pushUnavailableForm(res);
          return;
        }
        this.pushHandoffBanner();
      },
      error: (err) => {
        if (epoch !== this.requestEpoch || view !== this.viewToken) return;
        const body = err?.error && typeof err.error === 'object' ? err.error : {};
        if (err?.status === 409 || body.status === 'closed') {
          if (hooks?.userMessageId) this.rollbackMessage(hooks.userMessageId);
          this.currentDecision.set('closed');
          this.interaction.set('readonly');
          return;
        }
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

  private pushUserMessage(text: string): ChatMessage {
    const message: ChatMessage = {
      id: 'user-' + Date.now(),
      sender: 'user',
      text,
      timestamp: new Date()
    };
    this.messages.update(msgs => [...msgs, message]);
    return message;
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
    this.http.post(
      `${environment.apiUrl}/ai-chat/sessions/${this.sessionId()}/messages/${messageId}/order-card`,
      { orderCard: card, text }
    ).subscribe({ error: () => {} });
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
    this.humanChatActive.set(true);
    this.messages.update(msgs => [...msgs, {
      id: 'sys-' + Date.now(),
      sender: 'system',
      text: 'Your conversation has been sent to our support team. You can continue messaging here.',
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
