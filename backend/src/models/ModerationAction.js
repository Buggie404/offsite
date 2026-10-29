const mongoose = require('mongoose');

// History of every community moderation decision (hide, restore, warn, lock, dismiss).
// Feeds the "Handled" tab of Community reports; append-only like ActivityLogs.
const moderationActionSchema = new mongoose.Schema({
  action_id: { type: String, required: true, unique: true, default: () => new mongoose.Types.ObjectId().toString() },
  target_type: { type: String, required: true, enum: ['post', 'comment', 'account'] },
  target_id: { type: String, required: true, index: true },   // post_id / comment_id / user_id
  owner_id: { type: String, default: null, index: true },     // user_id of the author / reported account
  owner_name: { type: String, default: null },
  action: { type: String, required: true, enum: ['hide', 'restore', 'warn', 'lock', 'unlock', 'dismiss'] },
  also_hidden: { type: Boolean, default: false },              // warn / lock that also hid the content
  message: { type: String, default: null, maxlength: 1000 },   // text sent to the author
  reports_closed: { type: Number, default: 0 },
  admin_id: { type: String, required: true },
  admin_name: { type: String, default: null },
  admin_role: { type: String, required: true, enum: ['admin_cc', 'cskh', 'qlsp'] },
  created_at: { type: Date, default: Date.now, immutable: true }
}, { collection: 'ModerationActions', versionKey: false });

moderationActionSchema.index({ created_at: -1 });

module.exports = mongoose.model('ModerationAction', moderationActionSchema);
