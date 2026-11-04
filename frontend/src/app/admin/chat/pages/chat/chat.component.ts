import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, forkJoin } from 'rxjs';
import { customerKey, groupChats } from './chat-grouping';
import { ChatConversation, ChatMessage, ChatService } from '../../../../core/services/chat.service';
import { AdminAuthService } from '../../../auth/services/admin-auth.service';

type StatusFilter = 'all' | 'waiting' | 'open' | 'closed';

@Component({
  selector: 'app-admin-chat',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class AdminChatComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private auth = inject(AdminAuthService);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  private subs = new Subscription();

  @ViewChild('thread') private thread?: ElementRef<HTMLElement>;

  filters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' }
  ];
  filter: StatusFilter = 'all';

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
  get myId(): string | undefined { return this.auth.getUser()?.user_id; }
  loadError = '';

  get visible(): ChatConversation[] {
    const grouped = groupChats(this.conversations);
    return this.filter === 'all' ? grouped : grouped.filter(c => c.status === this.filter);
  }

  get waitingCount(): number { return groupChats(this.conversations).filter(c => c.status === 'waiting').length; }

  get canReply(): boolean {
    return !!this.active?.agent_id && this.active.status === 'open' &&
      [this.myId, this.auth.getUser()?._id].includes(this.active.agent_id);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const status = params.get('status');
    if (this.filters.some(f => f.value === status)) this.filter = status as StatusFilter;
    this.openId = params.get('conversation');

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
        this.messages = [...this.messages.filter(existing => existing._id !== m._id || !m._id), m]
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        this.customerTyping = false;
        this.scrollSoon();
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
    this.subs.unsubscribe();
    clearTimeout(this.typingTimer);
    clearTimeout(this.stopTypingTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.chat.disconnect();
  }

  loadList(): void {
    this.chat.list().subscribe({
      next: res => {
        this.conversations = res.data;
        this.loadError = '';
        for (const c of res.data) {
          if (c.unread_agent > 0 && c.last_message_at) this.chat.receipt(c.conversation_id, 'delivered', c.last_message_at).subscribe({ error: () => {} });
        }
        if (this.openId) {
          const target = res.data.find(c => c.conversation_id === this.openId);
          this.openId = null;
          if (target) this.select(target);
        }
        if (this.active) {
          const fresh = groupChats(res.data).find(c => customerKey(c) === customerKey(this.active!));
          if (fresh) {
            this.active = fresh;
            this.refreshMessages(fresh.conversation_id);
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
    this.active = c;
    this.messages = [];
    this.customerTyping = false;
    this.refreshMessages(c.conversation_id);
  }

  private refreshMessages(conversationId: string): void {
    if (!this.active) return;
    const key = customerKey(this.active);
    const threads = this.conversations.filter(c => customerKey(c) === key);
    threads.forEach(c => this.chat.joinConversation(c.conversation_id));
    forkJoin(threads.map(c => this.chat.messages(c.conversation_id))).subscribe({
      next: results => {
        if (!this.active || customerKey(this.active) !== key) return;
        this.messages = results.flatMap(res => res.data).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        results.forEach((res, index) => {
          const last = res.data.at(-1);
          if (last && document.visibilityState === 'visible') this.chat.receipt(threads[index].conversation_id, 'seen', last.created_at).subscribe({ error: () => {} });
          threads[index].unread_agent = 0;
        });
        this.active.unread_agent = 0;
        this.scrollSoon();
        this.cdr.markForCheck();
      }
    });
  }

  claim(): void {
    if (!this.active) return;
    this.chat.claim(this.active.conversation_id).subscribe({
      next: res => { this.active = { ...this.active!, ...res.data }; this.loadList(); },
      error: err => alert(err?.error?.error || 'Could not claim this chat')
    });
  }

  closeChat(): void {
    if (!this.active || !confirm('Close this conversation?')) return;
    this.chat.close(this.active.conversation_id).subscribe({
      next: res => { this.active = { ...this.active!, ...res.data }; this.loadList(); }
    });
  }

  onDraftInput(): void {
    if (!this.active) return;
    this.chat.typing(this.active.conversation_id, true);
    clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = setTimeout(() => this.chat.typing(this.active!.conversation_id, false), 2000);
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || !this.canReply) return;
    this.chat.send(this.active!.conversation_id, text);
    this.chat.typing(this.active!.conversation_id, false);
    this.draft = '';
    this.cdr.markForCheck();
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  customerName(c: ChatConversation): string { return c.customer?.profile_name || c.customer_id; }

  private scrollSoon(): void {
    setTimeout(() => {
      const el = this.thread?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
