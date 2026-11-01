const mongoose = require('mongoose');

// History of every community moderation decision (hide, restore, warn, suspend, lift, dismiss).
// lock / unlock remain for decisions made before accounts could no longer be locked.
// Feeds the "Handled" tab of Community reports; append-only like ActivityLogs.
const moderationActionSchema = new mongoose.Schema({
  action_id: { type: String, required: true, unique: true, default: () => new mongoose.Types.ObjectId().toString() },
  target_type: { type: String, required: true, enum: ['post', 'comment', 'account'] },
  target_id: { type: String, required: true, index: true },   // post_id / comment_id / user_id
  owner_id: { type: String, default: null, index: true },     // user_id of the author / reported account
  owner_name: { type: String, default: null },
  action: { type: String, required: true, enum: ['hide', 'restore', 'warn', 'suspend_3d', 'suspend_7d', 'lift', 'lock', 'unlock', 'dismiss'] },
  also_hidden: { type: Boolean, default: false },              // penalty that also hid the content
  restricted_until: { type: Date, default: null },             // end of the suspension
  message: { type: String, default: null, maxlength: 1000 },   // text sent to the author
  reports_closed: { type: Number, default: 0 },
  admin_id: { type: String, required: true },
  admin_name: { type: String, default: null },
  admin_role: { type: String, required: true, enum: ['admin_cc', 'cskh', 'qlsp'] },
  created_at: { type: Date, default: Date.now, immutable: true }
}, { collection: 'ModerationActions', versionKey: false });

moderationActionSchema.index({ created_at: -1 });

module.exports = mongoose.model('ModerationAction', moderationActionSchema);
