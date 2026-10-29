const mongoose = require('mongoose');

const senderSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  username: { type: String, required: true },
  avatar_url: { type: String, default: null }
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  notification_id: { type: String, required: true, unique: true },
  recipient_id: { type: String, required: true }, // custom user_id string, e.g. USR000001
  sender: { type: senderSchema, default: null }, // can be null for system notifications, or contains sender profile
  type: {
    type: String,
    enum: [
      'POST_CREATED',
      'POST_LIKED',
      'POST_COMMENTED',
      'COMMENT_REPLIED',
      'COMMENT_LIKED',
      'ORDER_PLACED',
      'ORDER_SHIPPING',
      'ORDER_CANCELED',
      'ORDER_DELIVERY_FAILED',
      'ORDER_CANCELED_BY_STORE',
      'REFUND_REQUESTED',
      'REFUND_APPROVED',
      'REFUND_REJECTED',
      'SUBSCRIPTION_PAUSED',
      'SUBSCRIPTION_RESUMED',
      'SUBSCRIPTION_CANCELLED',
      'SUBSCRIPTION_UPCOMING',
      'SUBSCRIPTION_PAYMENT_FAILED',
      'SUBSCRIPTION_SUSPENDED',
      'SUBSCRIPTION_OUT_OF_STOCK',
      'SUBSCRIPTION_SKIPPED',
      'SUBSCRIPTION_PROPOSAL',
      'SUBSCRIPTION_PROPOSAL_WITHDRAWN',
      'SUBSCRIPTION_NOT_STARTED',
      'SUBSCRIPTION_ADJUSTED',
      'PANTRY_EXPIRY_SOON',
      // Community reports (admin moderation): message written by staff; post_id only when there is a post to open
      'COMMUNITY_MODERATION',
      'COMMUNITY_REPORT_RESOLVED'
    ],
    required: true
  },
  // Target post_id / order_id for redirecting; Ritual Box notifications use subscription_id instead.
  post_id: { type: String, required() { return !this.type?.startsWith('SUBSCRIPTION_') && !this.type?.startsWith('COMMUNITY_'); }, default: null },
  subscription_id: { type: String, default: null },
  order_id: { type: String, default: null }, // Ritual Box notifications about an order (e.g. SUBSCRIPTION_NOT_STARTED)
  message: { type: String, default: null }, // Ritual Box: text shown to the customer
  comment_id: { type: String, default: null }, // Optional comment_id
  comment_content: { type: String, default: null }, // Optional snippet of comment/reply
  is_read: { type: Boolean, default: false }
}, {
  collection: 'Notifications',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Notification', notificationSchema);
