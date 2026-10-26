export interface ChatMessageProduct {
  id?: number | string;
  name: string;
  price: string;
  imageUrl?: string;
  slug?: string;
  rawProduct?: any;
  defaultSku?: string;
  quantity?: number;
  inStock?: boolean;
  actionText?: string;
}

export interface ChatOrderItem {
  name: string;
  quantity: number;
}

export interface ChatMessageOrder {
  code: string;
  orderId?: string;
  contact?: string;
  status: string;
  progressPercent?: number;
  expectedDate?: string;
  city?: string;
  items?: ChatOrderItem[];
  total?: number;
  currency?: string;
  trackLinkText?: string;
}

export interface ChatContactCard {
  title?: string;
  hotline?: string;
  faqUrl?: string;
}

export interface ChatSupportAction {
  kind: 'cskh' | 'tracking' | 'refund';
  label: string;
  handoverReason?: string;
  orderId?: string;
  summary?: string;
}

export type ChatInteraction = 'loading' | 'ready' | 'idle' | 'readonly';

export type ChatDecision = 'continue' | 'idle' | 'rotate' | 'closed';

export interface ChatHistoryItem {
  session_id: string;
  preview: string;
  last_activity_at: string;
  created_at: string;
  status: string;
  decision: ChatDecision;
}

export interface ChatMessage {
  id: string;
  sender: 'ai' | 'user' | 'agent' | 'system';
  text?: string;
  formattedHtml?: string;
  timestamp: Date;
  noticeKind?: 'status';
  quickReplies?: string[];
  products?: ChatMessageProduct[];
  productCard?: ChatMessageProduct;
  orderCard?: ChatMessageOrder;
  orderCards?: ChatMessageOrder[];
  showOrderForm?: boolean;
  orderForm?: { code: string; contact: string };
  showContactForm?: boolean;
  contactSubmitted?: boolean;
  contactCard?: ChatContactCard;
  supportActions?: ChatSupportAction[];
  agentInfo?: {
    avatarInitial: string;
    senderName: string;
    subNote?: string;
  };
}
