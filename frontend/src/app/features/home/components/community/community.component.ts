// ─────────────────────────────────────────────────────────────
//  home/components/community/community.component.ts
//
//  Hiển thị 3 bài post NHIỀU LIKE NHẤT từ DB lên homepage.
//  Cấu trúc giống recipe/product: dùng CommunityService (community/services)
//  + Post model (community/models).
//  Nếu API lỗi hoặc DB chưa có data → fallback về 3 card mẫu.
// ─────────────────────────────────────────────────────────────

import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { CommunityService } from '../../services/community.service';
import { Post } from '../../models/post.model';
import { AuthService } from '../../../../core/auth.service';
import { AuthPromptModalService } from '../../../../shared/components/auth-prompt-modal/auth-prompt-modal.service';

// Fallback images (Unsplash) – dùng khi bài post trong DB không có ảnh
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?q=80&w=400&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?q=80&w=400&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?q=80&w=400&auto=format&fit=crop'
];

const BG_COLORS = [
  'var(--color-sage)',
  'var(--color-wheat)',
  'var(--color-blush-pink)'
];

// ── Hardcoded fallback (khi API không trả về data) ───────────
const DEFAULT_CARDS = [
  {
    community_name: '@THANHTRUC.HOME',
    content: 'Ceremonial Matcha mornings hitting different today. 🍵✨',
    image: FALLBACK_IMAGES[0],
    likes: 412,
    bgColor: BG_COLORS[0]
  },
  {
    community_name: '@STUDIO.MINIMAL',
    content: 'The Yirgacheffe notes are incredible. Ritual in every pixel.',
    image: FALLBACK_IMAGES[1],
    likes: 284,
    bgColor: BG_COLORS[1]
  },
  {
    community_name: '@GEOMETRIC.EYES',
    content: 'Iced Latte layers are my favorite kind of architecture. 🧊🥛',
    image: FALLBACK_IMAGES[2],
    likes: 591,
    bgColor: BG_COLORS[2]
  }
];

export interface CommunityCard {
  postId:         string | null; // _id của bài post, null nếu fallback
  community_name: string;
  preview:        string;   // tối đa 10 từ + '...'
  image:          string;
  likes:          number;
  bgColor:        string;
}

@Component({
  selector: 'app-community',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './community.component.html',
  styleUrls: ['./community.component.scss']
})
export class CommunityComponent implements OnInit {
  // Hiển thị ngay fallback trong khi chờ API
  cards: CommunityCard[] = DEFAULT_CARDS.map(d => ({
    postId: null,
    community_name: d.community_name,
    preview: d.content.trim().split(/\s+/).slice(0, 10).join(' '),
    image: d.image,
    likes: d.likes,
    bgColor: d.bgColor
  }));

  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private communityService: CommunityService,
    private router: Router,
    private authService: AuthService,
    private authPromptService: AuthPromptModalService
  ) {}

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loadTopLiked();
  }

  private loadTopLiked() {
    this.communityService.getTopLiked(3).subscribe({
      next: (res) => {
        const posts: Post[] = res?.data ?? [];

        if (!Array.isArray(posts) || posts.length === 0) {
          // DB chưa có data → giữ fallback
          return;
        }

        this.cards = posts.slice(0, 3).map((post, i) => {
          const hasMedia = post.media?.length > 0 && !!post.media[0].url;
          return this.toCard({
            postId: post._id ?? null,
            community_name: post.author?.username
              ? `@${post.author.username.toUpperCase()}`
              : DEFAULT_CARDS[i]?.community_name ?? '@USER',
            content: post.content || DEFAULT_CARDS[i]?.content || '',
            image:   hasMedia ? post.media[0].url : FALLBACK_IMAGES[i],
            likes:   post.like_count ?? 0,
            bgColor: BG_COLORS[i] ?? 'var(--color-cream)'
          }, i);
        });
        this.cdr.markForCheck();
      },
      error: () => {
        // Giữ nguyên fallback đã hiển thị sẵn
        console.warn('[CommunityComponent] API không phản hồi, dùng fallback data.');
        this.cdr.markForCheck();
      }
    });
  }

  /** Xử lý click vào card: navigate tới post detail nếu đã login, else open auth modal */
  onCardClick(card: CommunityCard): void {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    if (card.postId) {
      this.router.navigate(['/community/post', card.postId]);
    } else {
      this.router.navigate(['/community']);
    }
  }

  /** Xử lý click "SHARE YOUR BREW": navigate tới community nếu đã login, else open auth modal */
  onShareBrew(): void {
    if (!this.authService.isAuthenticated()) {
      this.authPromptService.open();
      return;
    }
    this.router.navigate(['/community']);
  }

  /** Map raw data → CommunityCard với preview cắt 10 từ */
  private toCard(raw: { postId: string | null; community_name: string; content: string; image: string; likes: number; bgColor: string }, _index: number): CommunityCard {
    return {
      postId:         raw.postId,
      community_name: raw.community_name,
      preview:        this.truncate(raw.content),
      image:          raw.image,
      likes:          raw.likes,
      bgColor:        raw.bgColor
    };
  }

  private truncate(text: string, wordLimit = 10): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= wordLimit) return text;
    return words.slice(0, wordLimit).join(' ') + '...';
  }
}
