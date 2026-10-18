const mongoose = require('mongoose');

// Mỗi dòng là một lần cộng hoặc trừ điểm thành viên.
// pending  → đã ghi nhận nhưng chưa khả dụng (vd. đơn mới delivered, còn trong hạn hoàn)
// posted   → đã cộng vào Users.points (khả dụng)
// reversed → bị thu hồi (hoàn đơn, nội dung bị ẩn do vi phạm)
// used     → điểm đã dùng (đổi voucher)

const TYPES = [
  'purchase',
  'review',
  'referral_register',
  'referral_order',
  'post_approved',
  'recipe_approved',
  'recipe_curated',
  'redeem_voucher',
  'quiz',
  'adjust'
];
const STATUSES = ['pending', 'posted', 'reversed', 'used'];
const REF_TYPES = ['order', 'review', 'referral', 'post', 'recipe', 'voucher', 'quiz'];

const pointTransactionSchema = new mongoose.Schema({
  transaction_id: { type: String, unique: true, index: true },   // PTX000001, generated in pre-validate hook
  user_id:  { type: String, required: true, index: true },        // Users.user_id (USR0000X)
  type:     { type: String, enum: TYPES, required: true },
  amount:   { type: Number, required: true },                     // cộng là số dương, trừ là số âm
  status:   { type: String, enum: STATUSES, default: 'pending', index: true },
  ref_type: { type: String, enum: REF_TYPES, default: null },     // bảng mà ref_id trỏ tới
  ref_id:   { type: String, default: null, index: true },         // order_id, review_id, post_id, ...
  posted_at:   { type: Date, default: null },                     // lúc chuyển sang posted
  reversed_at: { type: Date, default: null }
}, {
  collection: 'PointTransactions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Posting job: pending transactions waiting for their hold period to end.
pointTransactionSchema.index({ status: 1, created_at: 1 });

pointTransactionSchema.pre('validate', async function(next) {
  if (this.transaction_id) return next();
  try {
    const latest = await this.constructor.findOne(
      { transaction_id: /^PTX\d+$/ },
      { transaction_id: 1 },
      { sort: { created_at: -1 } }
    );
    const lastNum = latest ? parseInt(latest.transaction_id.slice(3), 10) : 0;
    this.transaction_id = `PTX${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(6, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('PointTransaction', pointTransactionSchema);
module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
module.exports.REF_TYPES = REF_TYPES;
