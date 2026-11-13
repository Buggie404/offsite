import { afterNextRender, ChangeDetectorRef, Component, ElementRef, Injector, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, forkJoin, catchError, of } from 'rxjs';
import { customerKey, groupChats } from './chat-grouping';
import { ChatAgent, ChatConversation, ChatMessage, ChatService } from '../../../../core/services/chat.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';
import { AdminCustomersService, CustomerDetail, CustomerOrder } from '../../../customers/services/admin-customers.service';
import { avatarInitials } from '../../../../shared/utils/avatar';
import { ReportPayload, ReportPostModalComponent } from '../../../../features/community/components/report-post-modal/report-post-modal.component';
import { VouchersComponent } from '../../../vouchers/pages/vouchers/vouchers.component';
import { AdminVoucher } from '../../../vouchers/services/admin-vouchers.service';

type StatusFilter = 'waiting' | 'mine' | 'closed' | 'all';

@Component({
  selector: 'app-admin-chat',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, ReportPostModalComponent, VouchersComponent],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class AdminChatComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private auth = inject(AdminAuthService);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);
  private customers = inject(AdminCustomersService);
  customerDetails: (CustomerDetail & { recent_orders: CustomerOrder[] }) | null = null;
  customerDetailsLoading = false;
  private customerRequest?: Subscription;
  readonly initials = avatarInitials;
  reportOpen = false;
  reportPending = false;
  readonly quickReplies = [
    { label: 'Order issue', text: 'Could you describe the issue with the item you received?' },
    { label: 'Refund timeline', text: 'I can check the refund status with our Orders team for you.' },
    { label: 'Shipping times', text: 'Let me check the shipping status and estimated delivery for your order.' },
    { label: 'Brewing help', text: 'What are you brewing, and which equipment are you using?' }
  ];
  voucherCustomer: { user_id: string; profile_name: string; conversation_id: string } | null = null;
  openVoucher(): void {
    if (!this.active || !this.canReply || this.active.customer_id.startsWith('guest:')) return;
    this.voucherCustomer = { user_id: this.active.customer_id, profile_name: this.customerName(this.active), conversation_id: this.active.conversation_id };
  }
  sendVoucher(event: { voucher: AdminVoucher; message: string; conversation_id: string }): void {
    this.chat.send(event.conversation_id, [event.message, `Your personal voucher code: ${event.voucher.code}`].filter(Boolean).join('\n'));
    this.voucherCustomer = null;
  }
  useQuickReply(text: string): void { if (this.canReply) this.draft = text; }
  reportCustomer(payload: ReportPayload): void {
    if (!this.active || !this.canReply || this.reportPending || this.active.customer_id.startsWith('guest:')) return;
    this.reportPending = true;
    this.chat.reportCustomer(this.active.customer_id, payload.reason, payload.note).subscribe({
      next: () => { this.reportPending = false; this.reportOpen = false; this.actionError = ''; this.cdr.markForCheck(); },
      error: error => { this.reportPending = false; this.reportOpen = false; this.actionError = error?.error?.error || 'Could not report this customer.'; this.cdr.markForCheck(); }
    });
  }
  orderCards(message: ChatMessage) {
    const cards = [...(message.metadata?.orderCard ? [message.metadata.orderCard] : []), ...(Array.isArray(message.metadata?.orders) ? message.metadata.orders : [])];
    return [...new Map(cards.filter(card => card && (card.code || card.order_id)).map(card => [card.code || card.order_id, { ...card, code: (card.code || card.order_id || '').replace(/^#/, ''), status: (card.status || card.order_status || 'Order').replaceAll('_', ' '), total: card.total ?? card.total_amount, image: card.image_url || card.imageUrl, itemCount: card.item_count ?? card.items?.reduce((total, item) => total + (item.quantity || 0), 0) }])).values()];
  }

  get pastChats(): number {
    if (this.customerDetails?.past_chats != null) return Math.max(0, this.customerDetails.past_chats - (this.active?.status === 'closed' ? 1 : 0));
    return this.active ? this.conversations.filter(c => customerKey(c) === customerKey(this.active!) && c.status === 'closed' && c.conversation_id !== this.active!.conversation_id).length : 0;
  }
  get lastOrder() { return this.customerDetails?.recent_orders[0] || null; }
  get customerProfileUrl(): string | null {
    return this.customerDetails ? `/admin/service-customers/${encodeURIComponent(this.customerDetails.user_id)}` : null;
  }
  get closedLabel(): string {
    return this.active ? this.outcomeLabel(this.active) : 'Closed';
  }
  outcomeLabel(conversation: ChatConversation): string {
    if (conversation.close_outcome) return ({ resolved: 'Resolved', forwarded: 'Forwarded to Orders', no_response: 'No response', spam: 'Spam or abusive' })[conversation.close_outcome];
    return conversation.close_reason === 'resolved' ? 'Resolved' : conversation.close_reason === 'idle' ? 'No response' : conversation.close_reason === 'return_to_bot' ? 'Returned to chatbot' : 'Closed';
  }
  private subs = new Subscription();

  @ViewChild('thread') private thread?: ElementRef<HTMLElement>;
  @ViewChild('transferDialog') private transferDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('closeDialog') private closeDialog?: ElementRef<HTMLDialogElement>;
  closeOpen = false;
  orderShareOpen = false;
  orderShareId = '';
  closeOutcome = 'resolved';
  closeSummary = '';
  sendClosingMessage = true;
  readonly closeOutcomes = [
    { value: 'resolved', label: 'Resolved' },
    { value: 'forwarded', label: 'Forwarded to Orders team (refund / order change)' },
    { value: 'no_response', label: 'Customer stopped replying' },
    { value: 'spam', label: 'Spam or abusive' }
  ];
  get selectedAgent() { return this.agents.find(agent => agent.user_id === this.transferTarget); }

  filters: { value: StatusFilter; label: string }[] = [
    { value: 'waiting', label: 'Waiting' },
    { value: 'mine', label: 'Mine' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' }
  ];
  filter: StatusFilter = 'waiting';
  search = '';
  sourceFilter: 'all' | 'ai' | 'direct' = 'all';
  sortOrder: 'latest' | 'oldest' = 'latest';
  actionPending = false;
  actionError = '';
  supportOpen = true;
  supportHours = '08:00–22:00 (Vietnam time)';
  transferOpen = false;
  transferTarget = '';
  transferNote = '';
  agents: ChatAgent[] = [];

  conversations: ChatConversation[] = [];
  active: ChatConversation | null = null;
  messages: ChatMessage[] = [];
  draft = '';
  customerTyping = false;
  private typingTimer: any = null;
  private stopTypingTimer: any = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Chat requested by the dashboard link, opened after the list loads. */
  private openId: string | null = null;
  get isSenior(): boolean { return this.auth.getUser()?.role === 'admin_cc'; }
  assignedAgent = '';
  inboxAgents: ChatAgent[] = [];

  matchesAssignedAgent(c: ChatConversation): boolean {
    return !this.isSenior || !this.assignedAgent || (c.agent_user_id || c.agent_id) === this.assignedAgent;
  }

  setAssignedAgent(id: string): void {
    this.assignedAgent = id;
    this.setFilter('all');
  }

  assignedCount(id: string): number {
    return groupChats(this.conversations.filter(c => c.status === 'open' && (c.agent_user_id || c.agent_id) === id)).length;
  }

  get myId(): string | undefined { return this.auth.getUser()?.user_id; }
  loadError = '';

  get visible(): ChatConversation[] {
    const term = this.search.trim().toLocaleLowerCase();
    const matches = this.conversations.filter(c => this.matchesTab(c, this.filter) && this.matchesAssignedAgent(c) &&
      (this.sourceFilter === 'all' || this.source(c) === this.sourceFilter) &&
      (!term || [this.customerName(c), c.customer_id, c.customer?.user_id, c.conversation_id]
        .some(value => value?.toLocaleLowerCase().includes(term))));
    return groupChats(matches).sort((a, b) => {
      const difference = Date.parse(b.last_message_at) - Date.parse(a.last_message_at);
      return this.sortOrder === 'oldest' ? -difference : difference;
    });
  }

  private isMine(c: ChatConversation): boolean {
    return !!c.agent_id && [this.myId, this.auth.getUser()?._id].includes(c.agent_id);
  }

  private matchesTab(c: ChatConversation, tab: StatusFilter): boolean {
    if (tab === 'all') return c.status !== 'bot';
    if (tab === 'mine') return c.status === 'open' && this.isMine(c);
    return c.status === tab;
  }

  tabCount(tab: StatusFilter): number {
    return groupChats(this.conversations.filter(c => this.matchesTab(c, tab) && this.matchesAssignedAgent(c))).length;
  }

  source(c: ChatConversation): 'ai' | 'direct' {
    return c.ai_session_id || c.dify_conversation_id || c.handover_reason || c.handoff_summary ? 'ai' : 'direct';
  }

  get waitingCount(): number { return this.tabCount('waiting'); }
  get mineCount(): number { return this.tabCount('mine'); }
  get canClaim(): boolean { return this.supportOpen && !!this.active && this.active.status === 'waiting' && !this.active.agent_id; }
  get canClose(): boolean { return this.canReply || (this.auth.getUser()?.role === 'admin_cc' && this.active?.status === 'open'); }
  get activeState(): string {
    if (!this.active) return '';
    if (this.active.status === 'closed') return `Closed${this.isSenior && this.active.closed_by_name ? ' by ' + this.active.closed_by_name : ''} · read only`;
    if (this.canClaim) return 'Unclaimed · view only';
    if (this.canReply) return 'Claimed by you';
    return 'Assigned to another agent · view only';
  }

  setFilter(filter: StatusFilter): void {
    this.customerRequest?.unsubscribe();
    this.customerDetails = null;
    this.customerDetailsLoading = false;
    this.filter = filter;
    this.active = null;
    this.messages = [];
    this.draft = '';
    this.customerTyping = false;
    this.actionError = '';
    this.transferOpen = false;
  }

  get canReply(): boolean {
    return !!this.active && this.active.status === 'open' && this.isMine(this.active);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const status = params.get('status');
    if (status === 'open') this.filter = 'mine'; // Existing dashboard links.
    else if (this.filters.some(f => f.value === status)) this.filter = status as StatusFilter;
    this.openId = params.get('conversation');

    if (this.isSenior) this.chat.agents().subscribe({
      next: res => { this.inboxAgents = res.data; this.cdr.markForCheck(); },
      error: () => { this.actionError = 'Could not load the admin list.'; this.cdr.markForCheck(); }
    });
    this.chat.joinAgents();
    this.loadList();
    this.refreshTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      this.loadList();
    }, 3000);

    this.subs.add(this.chat.conversation$.subscribe(c => {
      this.upsert(c);
      if (this.active?.conversation_id === c.conversation_id) {
        this.active = { ...this.active, ...c, customer: this.active.customer };
        this.refreshMessages(c.conversation_id);
      }
      this.cdr.markForCheck();
    }));

    this.subs.add(this.chat.message$.subscribe(m => {
      if (this.active && this.conversations.some(c => c.conversation_id === m.conversation_id && customerKey(c) === customerKey(this.active!))) {
        this.messages = this.uniqueMessages([...this.messages, m]);
        this.customerTyping = false;
        this.scrollSoon(true);
        if (document.visibilityState === 'visible') this.chat.receipt(m.conversation_id, 'seen', m.created_at).subscribe({ error: () => {} });
      }
      this.loadList(); // refresh previews + unread counters
    }));

    this.subs.add(this.chat.listHint$.subscribe(() => this.loadList()));

    this.subs.add(this.chat.typing$.subscribe(t => {
      if (t.conversation_id !== this.active?.conversation_id || t.user_id === this.myId) return;
      this.customerTyping = t.typing;
      clearTimeout(this.typingTimer);
      if (t.typing) this.typingTimer = setTimeout(() => { this.customerTyping = false; this.cdr.markForCheck(); }, 4000);
      this.cdr.markForCheck();
    }));
  }

  ngOnDestroy(): void {
    this.customerRequest?.unsubscribe();
    this.subs.unsubscribe();
    clearTimeout(this.typingTimer);
    clearTimeout(this.stopTypingTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.chat.disconnect();
  }

  loadList(): void {
    this.chat.list().subscribe({
      next: res => {
        this.supportOpen = res.support_open ?? true;
        this.supportHours = res.support_hours || this.supportHours;
        this.conversations = res.data;
        this.loadError = '';
        for (const c of res.data) {
          if (c.unread_agent > 0 && c.last_message_at) this.chat.receipt(c.conversation_id, 'delivered', c.last_message_at).subscribe({ error: () => {} });
        }
        if (this.openId) {
          const target = res.data.find(c => c.conversation_id === this.openId);
          this.openId = null;
          if (target) {
            this.filter = target.status === 'closed' ? 'closed' : this.isMine(target) && target.status === 'open' ? 'mine' : target.status === 'waiting' ? 'waiting' : 'all';
            this.select(target);
          }
        }
        if (this.active) {
          const fresh = res.data.find(c => c.conversation_id === this.active!.conversation_id);
          if (fresh) {
            this.active = fresh;
            this.refreshMessages(fresh.conversation_id);
          } else {
            this.active = null;
            this.messages = [];
            this.customerDetails = null;
          }
        }
        this.cdr.markForCheck();
      },
      error: err => {
        this.loadError = err?.error?.error || 'Could not load conversations. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  private upsert(c: ChatConversation): void {
    const i = this.conversations.findIndex(x => x.conversation_id === c.conversation_id);
    if (i >= 0) this.conversations[i] = { ...this.conversations[i], ...c };
    else this.loadList();
  }

  select(c: ChatConversation): void {
    this.reportOpen = false;
    this.orderShareOpen = false; this.orderShareId = '';
    this.customerRequest?.unsubscribe();
    this.customerDetails = null;
    this.customerDetailsLoading = false;
    this.transferOpen = false;
    this.draft = '';
    this.actionError = '';
    this.active = c;
    this.messages = [];
    this.customerTyping = false;
    this.refreshMessages(c.conversation_id, true);
    this.loadCustomerDetails(c);
  }

  private loadCustomerDetails(c: ChatConversation): void {
    this.customerRequest?.unsubscribe();
    if (!c.customer_id.startsWith('guest:')) {
      this.customerDetailsLoading = true;
      const customerId = c.customer?.user_id || c.customer_id;
      this.customerRequest = forkJoin({ profile: this.customers.get(customerId), orders: this.customers.orders(customerId, 1) }).subscribe({
        next: response => { this.customerDetails = response.profile.data ? { ...response.profile.data, recent_orders: response.orders.data } : null; this.customerDetailsLoading = false; this.cdr.markForCheck(); },
        error: () => { this.customerDetailsLoading = false; this.cdr.markForCheck(); }
      });
    }
  }

  get sessionThreads(): { conversation: ChatConversation; messages: ChatMessage[] }[] {
    if (!this.active) return [];
    return this.conversations.filter(c => customerKey(c) === customerKey(this.active!))
      .map(conversation => ({ conversation, messages: this.messages.filter(m => m.conversation_id === conversation.conversation_id) }))
      .sort((a, b) => Date.parse(a.conversation.created_at || a.messages[0]?.created_at || a.conversation.last_message_at) - Date.parse(b.conversation.created_at || b.messages[0]?.created_at || b.conversation.last_message_at));
  }

  private refreshMessages(conversationId: string, forceScroll = false): void {
    if (!this.active) return;
    const key = customerKey(this.active);
    const threads = this.conversations.filter(c => customerKey(c) === key);
    threads.forEach(c => this.chat.joinConversation(c.conversation_id));
    forkJoin(threads.map(c => this.chat.messages(c.conversation_id).pipe(catchError(() => of({ data: [] as ChatMessage[] }))))).subscribe({
      next: results => {
        if (!this.active || this.active.conversation_id !== conversationId || customerKey(this.active) !== key) return;
        this.messages = this.uniqueMessages(results.flatMap(res => res.data));
        results.forEach((res, index) => {
          const last = res.data.at(-1);
          if (last && document.visibilityState === 'visible') this.chat.receipt(threads[index].conversation_id, 'seen', last.created_at).subscribe({ error: () => {} });
          threads[index].unread_agent = 0;
        });
        this.active.unread_agent = 0;
        this.scrollSoon(forceScroll);
        this.cdr.markForCheck();
      }
    });
  }

  claim(): void {
    if (!this.active || !this.canClaim || this.actionPending) return;
    const id = this.active.conversation_id;
    this.actionPending = true;
    this.actionError = '';
    this.chat.claim(this.active.conversation_id).subscribe({
      next: res => {
        this.actionPending = false;
        this.upsert(res.data);
        if (this.active?.conversation_id === id) {
          this.active = { ...this.active, ...res.data };
          this.filter = 'mine';
          this.loadCustomerDetails(this.active);
        }
        this.loadList();
        this.cdr.markForCheck();
      },
      error: err => { this.actionPending = false; this.actionError = err?.error?.error || 'Could not claim this chat'; this.cdr.markForCheck(); }
    });
  }

  closeChat(): void {
    if (!this.active || !this.canClose || this.actionPending) return;
    this.closeOutcome = 'resolved'; this.closeSummary = ''; this.sendClosingMessage = true; this.actionError = '';
    this.closeOpen = true;
    this.closeDialog?.nativeElement.showModal?.();
  }

  dismissDialogs(): void {
    if (this.actionPending) return;
    this.transferOpen = false; this.closeOpen = false;
    this.transferDialog?.nativeElement.close?.(); this.closeDialog?.nativeElement.close?.();
  }

  confirmClose(): void {
    if (!this.active || !this.canClose || !this.closeOpen || !this.closeOutcomes.some(outcome => outcome.value === this.closeOutcome) || this.closeSummary.length > 1000 || this.actionPending) return;
    const id = this.active.conversation_id;
    this.actionPending = true;
    this.actionError = '';
    this.chat.close(this.active.conversation_id, { outcome: this.closeOutcome, summary: this.closeSummary.trim(), send_closing_message: this.sendClosingMessage }).subscribe({
      next: res => {
        this.actionPending = false;
        this.dismissDialogs();
        this.upsert(res.data);
        if (this.active?.conversation_id === id) {
          this.active = { ...this.active, ...res.data };
          this.filter = 'closed';
          this.draft = '';
          this.loadCustomerDetails(this.active);
        }
        this.loadList();
        this.cdr.markForCheck();
      },
      error: err => { this.actionPending = false; this.actionError = err?.error?.error || 'Could not close this chat'; this.cdr.markForCheck(); }
    });
  }

  onDraftInput(): void {
    if (!this.active || !this.canReply) return;
    const id = this.active.conversation_id;
    this.chat.typing(id, true);
    clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = setTimeout(() => this.chat.typing(id, false), 2000);
  }

  openTransfer(): void {
    if (!this.canClose || !this.supportOpen) return;
    this.transferTarget = '';
    this.transferNote = '';
    this.actionError = '';
    this.chat.agents().subscribe({
      next: response => { this.agents = response.data.filter(agent => agent.user_id !== this.active?.agent_id); this.transferOpen = true; this.transferDialog?.nativeElement.showModal?.(); this.cdr.markForCheck(); },
      error: () => { this.actionError = 'Could not load agents'; this.cdr.markForCheck(); }
    });
  }

  transfer(): void {
    if (!this.active || !this.canClose || !this.supportOpen || !this.transferTarget || this.selectedAgent?.available === false || !this.transferNote.trim() || this.transferNote.length > 1000 || this.actionPending) return;
    const id = this.active.conversation_id;
    this.actionPending = true;
    this.chat.transfer(id, this.transferTarget, this.transferNote.trim()).subscribe({
      next: response => {
        this.actionPending = false;
        this.dismissDialogs();
        this.customerRequest?.unsubscribe(); this.customerDetails = null;
        this.upsert(response.data);
        if (this.active?.conversation_id === id) { this.active = { ...this.active, ...response.data }; this.filter = 'all'; this.draft = ''; }
        this.loadList(); this.cdr.markForCheck();
      },
      error: error => { this.actionPending = false; this.actionError = error?.error?.error || 'Could not transfer this chat'; this.cdr.markForCheck(); }
    });
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || !this.canReply) return;
    this.chat.send(this.active!.conversation_id, text);
    this.chat.typing(this.active!.conversation_id, false);
    this.draft = '';
    this.cdr.markForCheck();
  }

  shareOrder(): void {
    if (!this.active || !this.canReply || !this.orderShareId || this.actionPending) return;
    const id = this.active.conversation_id;
    this.actionPending = true; this.actionError = '';
    this.chat.shareOrder(id, this.orderShareId).subscribe({
      next: response => {
        this.actionPending = false; this.orderShareOpen = false;
        if (this.active?.conversation_id === id && response.data && !this.messages.some(message => message._id === response.data?._id)) { this.messages = [...this.messages, response.data]; this.scrollSoon(true); }
        this.cdr.markForCheck();
      },
      error: error => { this.actionPending = false; this.actionError = error?.error?.error || 'Could not share this order.'; this.cdr.markForCheck(); }
    });
  }

  onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) this.send();
    }
  }

  private uniqueMessages(messages: ChatMessage[]): ChatMessage[] {
    const ids = new Set<string>();
    const sources = new Set<string>();
    return messages.filter(message => {
      const source = message.source_session_id && message.source_message_id
        ? JSON.stringify([message.source_session_id, message.source_message_id]) : null;
      const duplicate = !!((message._id && ids.has(message._id)) || (source && sources.has(source)));
      if (message._id) ids.add(message._id);
      if (source) sources.add(source);
      return !duplicate;
    }).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }

  customerName(c: ChatConversation): string { return c.customer?.profile_name || c.customer_id; }

  private scrollSoon(force = false): void {
    // Socket events must schedule a render before measuring the new thread height.
    this.cdr.markForCheck();
    const current = this.thread?.nativeElement;
    if (!force && current && current.scrollHeight - current.scrollTop - current.clientHeight > 80) return;
    const activeId = this.active?.conversation_id;
    const scrollTop = current?.scrollTop;
    afterNextRender(() => {
      const el = this.thread?.nativeElement;
      if (el && this.active?.conversation_id === activeId && (force || el.scrollTop === scrollTop)) {
        el.scrollTop = el.scrollHeight;
        // Let the browser finish sizing the composer and message cards as well.
        requestAnimationFrame(() => {
          if (this.thread?.nativeElement === el && this.active?.conversation_id === activeId) {
            el.scrollTop = el.scrollHeight;
          }
        });
      }
    }, { injector: this.injector });
  }
}
