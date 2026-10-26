export interface NotificationSender {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export interface Notification {
  _id: string;
  notification_id: string;
  recipient_id: string;
  sender: NotificationSender | null;
  type: 'POST_CREATED' | 'POST_LIKED' | 'POST_COMMENTED' | 'COMMENT_REPLIED' | 'COMMENT_LIKED' | 'ORDER_PLACED' | 'ORDER_SHIPPING' | 'ORDER_CANCELED' | 'ORDER_DELIVERY_FAILED' | 'ORDER_CANCELED_BY_STORE' | 'REFUND_REQUESTED' | 'REFUND_APPROVED' | 'REFUND_REJECTED'
    | 'SUBSCRIPTION_PAUSED' | 'SUBSCRIPTION_RESUMED' | 'SUBSCRIPTION_CANCELLED' | 'SUBSCRIPTION_UPCOMING' | 'SUBSCRIPTION_PAYMENT_FAILED'
    | 'SUBSCRIPTION_SUSPENDED' | 'SUBSCRIPTION_OUT_OF_STOCK' | 'SUBSCRIPTION_SKIPPED' | 'SUBSCRIPTION_PROPOSAL' | 'SUBSCRIPTION_PROPOSAL_WITHDRAWN' | 'SUBSCRIPTION_NOT_STARTED'
    | 'SUBSCRIPTION_ADJUSTED'
    | 'PANTRY_EXPIRY_SOON';
  /** Post / order id; null for Ritual Box notifications (older ones stored the subscription id here). */
  post_id: string | null;
  subscription_id?: string | null;
  message?: string | null;
  comment_id?: string | null;
  comment_content?: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}
