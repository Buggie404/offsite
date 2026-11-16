const Sequence = require('../models/ProductIdSequence');
const ProductBatch = require('../models/ProductBatch');
const ProductDraft = require('../models/ProductDraft');

// Reserving a number creates no batch and changes no inventory. Gaps are intentional.
async function nextBatchCode() {
  for (;;) {
    let sequence;
    try {
      sequence = await Sequence.findOneAndUpdate({ _id: 'batch-codes' }, { $inc: { value: 1 } },
        { upsert: true, new: true }).lean();
    } catch (error) { if (error.code === 11000) continue; throw error; }
    const code = `B-${String(sequence.value).padStart(6, '0')}`;
    const [batch, draft] = await Promise.all([
      ProductBatch.exists({ batch_code: code }),
      ProductDraft.exists({ 'payload.batch_changes.upserts.batch_code': code })
    ]);
    if (!batch && !draft) return code;
  }
}

module.exports = { nextBatchCode };
