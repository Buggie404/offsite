const ProductBatch = require('../models/ProductBatch');
const { vnDateKey } = require('./pantry.logic');

const fields = ['batch_code', 'variant_sku', 'quantity', 'received_at', 'best_before'];
const objectId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const day = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number(value.slice(0, 4)) > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const batchError = (message, status = 400) => Object.assign(new Error(message), { status });

function values(input) {
  return { batch_code: String(input?.batch_code || '').trim(), variant_sku: String(input?.variant_sku || '').trim(),
    quantity: input?.quantity, received_at: input?.received_at, best_before: input?.best_before || null };
}
function valid(row) {
  return row.batch_code && row.batch_code.length <= 80 && row.variant_sku && row.variant_sku.length <= 100
    && Number.isSafeInteger(row.quantity) && row.quantity >= 1 && day(row.received_at)
    && (!row.best_before || (day(row.best_before) && row.best_before >= row.received_at));
}

function normalizeBatchChanges(input, variants) {
  if (input == null) return null;
  if (!Array.isArray(input.upserts) || !Array.isArray(input.deletes) || input.upserts.length + input.deletes.length > 200) throw batchError('Invalid batch changes.');
  const skus = new Set(variants.map(variant => variant.sku));
  const ids = new Set(), clients = new Set(), codes = new Set();
  const upserts = input.upserts.map(inputRow => {
    const row = values(inputRow);
    if (!valid(row) || !skus.has(row.variant_sku) || codes.has(row.batch_code)) throw batchError('Each batch needs a unique code, a current variant SKU, positive whole quantity and valid dates.');
    codes.add(row.batch_code);
    if (inputRow.id != null) {
      if (!objectId(inputRow.id) || ids.has(inputRow.id) || !valid(values(inputRow.expected))) throw batchError('Invalid existing batch or original batch values.');
      ids.add(inputRow.id);
      return { id: inputRow.id, ...row, expected: values(inputRow.expected) };
    }
    if (typeof inputRow.client_id !== 'string' || !inputRow.client_id || inputRow.client_id.length > 100 || clients.has(inputRow.client_id)) throw batchError('Invalid new batch identifier.');
    clients.add(inputRow.client_id);
    return { client_id: inputRow.client_id, ...row };
  });
  const deletes = input.deletes.map(row => {
    if (!objectId(row?.id) || ids.has(row.id) || !valid(values(row.expected))) throw batchError('Invalid removed batch or original batch values.');
    ids.add(row.id);
    return { id: row.id, expected: values(row.expected) };
  });
  return upserts.length || deletes.length ? { upserts, deletes } : null;
}

function presentBatch(row) {
  const value = typeof row.toObject === 'function' ? row.toObject() : row;
  return { ...value, _id: String(value._id), received_at: vnDateKey(value.received_at),
    best_before: value.best_before ? vnDateKey(value.best_before) : null };
}
function snapshot(row) { return values(presentBatch(row)); }
function asDates(row) {
  return { ...values(row), received_at: new Date(`${row.received_at}T00:00:00+07:00`),
    best_before: row.best_before ? new Date(`${row.best_before}T00:00:00+07:00`) : null };
}

async function applyBatchChanges(productId, changes, actor, session, variants) {
  const current = await ProductBatch.find({ product_id: productId }).session(session).lean();
  const byId = new Map(current.map(row => [String(row._id), row]));
  for (const operation of [...changes.upserts.filter(row => row.id), ...changes.deletes]) {
    const row = byId.get(operation.id);
    if (!row || fields.some(field => snapshot(row)[field] !== operation.expected[field])) {
      throw batchError('A batch has changed or was removed since you opened this draft. Reload Edit product and review the batch changes.', 409);
    }
  }
  const removedIds = new Set(changes.deletes.map(row => row.id));
  const updated = new Map(changes.upserts.filter(row => row.id).map(row => [row.id, row]));
  const finalCodes = current.filter(row => !removedIds.has(String(row._id))).map(row => updated.get(String(row._id))?.batch_code || row.batch_code)
    .concat(changes.upserts.filter(row => !row.id).map(row => row.batch_code));
  if (new Set(finalCodes).size !== finalCodes.length) throw batchError('Batch code already exists for this product.', 409);
  const finalSkus = current.filter(row => !removedIds.has(String(row._id))).map(row => updated.get(String(row._id))?.variant_sku || row.variant_sku)
    .concat(changes.upserts.filter(row => !row.id).map(row => row.variant_sku));
  if (variants && finalSkus.some(sku => !variants.some(variant => variant.sku === sku))) throw batchError('A batch refers to a removed variant. Edit or remove that batch before publishing.');

  const events = [];
  for (const operation of changes.deletes) {
    await ProductBatch.deleteOne({ _id: operation.id, product_id: productId }, { session });
    events.push({ actionType: 'product.batch-delete', oldValue: operation.expected, newValue: null });
  }
  for (const operation of changes.upserts) {
    if (operation.id) {
      await ProductBatch.updateOne({ _id: operation.id, product_id: productId }, { $set: asDates(operation) }, { session, runValidators: true });
      events.push({ actionType: 'product.batch-update', oldValue: operation.expected, newValue: values(operation) });
    } else {
      await ProductBatch.create([{ product_id: productId, ...asDates(operation), added_by: String(actor.user_id),
        added_by_name: String(actor.profile_name || actor.email || actor.user_id).slice(0, 120) }], { session });
      events.push({ actionType: 'product.batch-create', oldValue: null, newValue: values(operation) });
    }
  }
  return events;
}

module.exports = { normalizeBatchChanges, presentBatch, applyBatchChanges };
