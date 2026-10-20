import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatConversation, ChatMessage, ChatService } from '../../../../core/services/chat.service';
import { AuthService } from '../../../../core/auth.service';

type StatusFilter = 'all' | 'waiting' | 'open' | 'closed';

@Component({
  selector: 'app-admin-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class AdminChatComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private auth = inject(AuthService);
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

  get myId(): string | undefined { return this.auth.currentUser()?.user_id; }

  get visible(): ChatConversation[] {
    return this.filter === 'all' ? this.conversations : this.conversations.filter(c => c.status === this.filter);
  }

  get waitingCount(): number { return this.conversations.filter(c => c.status === 'waiting').length; }

  get canReply(): boolean {
    return !!this.active && this.active.status === 'open' && this.active.agent_id === this.myId;
  }

  ngOnInit(): void {
    this.chat.joinAgents();
    this.loadList();

    this.subs.add(this.chat.conversation$.subscribe(c => {
      this.upsert(c);
      if (this.active?.conversation_id === c.conversation_id) this.active = { ...this.active, ...c, customer: this.active.customer };
      this.cdr.markForCheck();
    }));

    this.subs.add(this.chat.message$.subscribe(m => {
      if (this.active?.conversation_id === m.conversation_id) {
        this.messages = [...this.messages, m];
        this.customerTyping = false;
        this.scrollSoon();
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
    this.chat.disconnect();
  }

  loadList(): void {
    this.chat.list().subscribe({
      next: res => {
        this.conversations = res.data;
        if (this.active) {
          const fresh = res.data.find(c => c.conversation_id === this.active!.conversation_id);
          if (fresh) this.active = fresh;
        }
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
    this.chat.joinConversation(c.conversation_id);
    this.chat.messages(c.conversation_id).subscribe({
      next: res => {
        this.messages = res.data;
        c.unread_agent = 0;
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
