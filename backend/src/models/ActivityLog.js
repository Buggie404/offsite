const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  log_id: { type: String, required: true, unique: true, default: () => new mongoose.Types.ObjectId().toString() },
  admin_id: { type: String, required: true, index: true },
  admin_role: { type: String, required: true, enum: ['admin_cc', 'cskh', 'qlsp'] },
  action_type: { type: String, required: true, index: true },
  target_entity: { type: String, required: true },
  target_id: { type: String, required: true, index: true },
  old_value: { type: mongoose.Schema.Types.Mixed, default: null },
  new_value: { type: mongoose.Schema.Types.Mixed, default: null },
  reason: { type: String, default: null, maxlength: 500 },
  // Support ticket (customer chat) when staff act on the customer's request.
  ticket_id: { type: String, default: null, maxlength: 100 },
  created_at: { type: Date, default: Date.now, immutable: true }
}, { collection: 'ActivityLogs', versionKey: false });

activityLogSchema.index({ created_at: -1 });

// Append-only (Phân quyền Admin › Nhật ký hành động): a log is never edited or deleted, so every
// update / delete through Mongoose is refused. Older names are mapped when reading instead
// (activity-log.service LEGACY_ACTION_TYPE_ALIASES). Raw driver access isn't covered here.
const APPEND_ONLY_ERROR = 'ActivityLogs are append-only: logs cannot be updated or deleted.';
async function refuse() {
  throw new Error(APPEND_ONLY_ERROR);
}

activityLogSchema.pre('save', async function appendOnlySave() {
  if (!this.isNew) await refuse();
});
activityLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'],
  { document: true, query: true },
  refuse
);
// Mongoose 7 has no bulkWrite middleware: allow bulk inserts only.
activityLogSchema.statics.bulkWrite = function appendOnlyBulkWrite(ops, ...rest) {
  if (!Array.isArray(ops) || ops.some((op) => !op || Object.keys(op).some((kind) => kind !== 'insertOne'))) {
    return refuse();
  }
  return mongoose.Model.bulkWrite.call(this, ops, ...rest);
};

module.exports = mongoose.model('ActivityLog', activityLogSchema);
