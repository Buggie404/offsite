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
  type: 'POST_CREATED' | 'POST_LIKED' | 'POST_COMMENTED' | 'COMMENT_REPLIED' | 'COMMENT_LIKED' | 'ORDER_PLACED' | 'ORDER_SHIPPING' | 'ORDER_CANCELED' | 'REFUND_REQUESTED' | 'REFUND_APPROVED' | 'REFUND_REJECTED';
  post_id: string;
  comment_id?: string | null;
  comment_content?: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}
