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
      'REFUND_REQUESTED',
      'REFUND_APPROVED',
      'REFUND_REJECTED'
    ],
    required: true
  },
  post_id: { type: String, required: true }, // Target post_id for redirecting
  comment_id: { type: String, default: null }, // Optional comment_id
  comment_content: { type: String, default: null }, // Optional snippet of comment/reply
  is_read: { type: Boolean, default: false }
}, {
  collection: 'Notifications',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.model('Notification', notificationSchema);
