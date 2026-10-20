import { ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatConversation, ChatMessage, ChatService } from '../../../core/services/chat.service';
import { AuthService } from '../../../core/auth.service';

@Component({
  selector: 'app-support-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './support-chat.component.html',
  styleUrl: './support-chat.component.scss'
})
export class SupportChatComponent implements OnDestroy {
  private chat = inject(ChatService);
  private auth = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private subs = new Subscription();

  @ViewChild('thread') private thread?: ElementRef<HTMLElement>;

  isLoggedIn = this.auth.isAuthenticated;
  open = false;
  loading = false;
  conversation: ChatConversation | null = null;
  messages: ChatMessage[] = [];
  draft = '';
  agentTyping = false;
  private typingTimer: any = null;
  private stopTypingTimer: any = null;

  constructor() {
    // Drop the socket and local state on logout so the next user starts clean.
    effect(() => {
      if (!this.isLoggedIn()) {
        this.chat.disconnect();
        this.listening = false;
        this.subs.unsubscribe();
        this.subs = new Subscription();
        this.open = false;
        this.conversation = null;
        this.messages = [];
      }
    });
  }

  get myId(): string | undefined { return this.auth.currentUser()?.user_id; }
  get isClosed(): boolean { return this.conversation?.status === 'closed'; }

  toggle(): void {
    this.open = !this.open;
    if (this.open && !this.conversation && !this.loading) this.load();
  }

  private load(): void {
    this.loading = true;
    this.chat.connect();
    this.listen();
    this.chat.getMine().subscribe({
      next: res => {
        this.loading = false;
        if (res.data) this.attach(res.data);
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  private listening = false;
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.subs.add(this.chat.message$.subscribe(m => {
      if (m.conversation_id !== this.conversation?.conversation_id) return;
      this.messages = [...this.messages, m];
      this.agentTyping = false;
      this.scrollSoon();
      this.cdr.markForCheck();
    }));
    this.subs.add(this.chat.conversation$.subscribe(c => {
      if (c.customer_id !== this.myId) return;
      if (!this.conversation || this.conversation.conversation_id === c.conversation_id) {
        this.attach(c);
        this.cdr.markForCheck();
      }
    }));
    this.subs.add(this.chat.typing$.subscribe(t => {
      if (t.conversation_id !== this.conversation?.conversation_id || t.user_id === this.myId) return;
      this.agentTyping = t.typing;
      clearTimeout(this.typingTimer);
      if (t.typing) this.typingTimer = setTimeout(() => { this.agentTyping = false; this.cdr.markForCheck(); }, 4000);
      this.cdr.markForCheck();
    }));
  }

  private attach(c: ChatConversation): void {
    const isNew = this.conversation?.conversation_id !== c.conversation_id;
    this.conversation = c;
    if (!isNew) return;
    this.messages = [];
    this.chat.joinConversation(c.conversation_id);
    this.chat.messages(c.conversation_id).subscribe(res => {
      this.messages = res.data;
      this.scrollSoon();
      this.cdr.markForCheck();
    });
  }

  startChat(): void {
    this.loading = true;
    this.chat.start().subscribe({
      next: res => { this.loading = false; this.attach(res.data); this.cdr.markForCheck(); },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  newChat(): void {
    this.conversation = null;
    this.messages = [];
    this.startChat();
  }

  onDraftInput(): void {
    if (!this.conversation) return;
    this.chat.typing(this.conversation.conversation_id, true);
    clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = setTimeout(() => this.chat.typing(this.conversation!.conversation_id, false), 2000);
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || !this.conversation || this.isClosed) return;
    this.chat.send(this.conversation.conversation_id, text);
    this.chat.typing(this.conversation.conversation_id, false);
    this.draft = '';
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    clearTimeout(this.typingTimer);
    clearTimeout(this.stopTypingTimer);
    this.chat.disconnect();
  }

  private scrollSoon(): void {
    setTimeout(() => {
      const el = this.thread?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
