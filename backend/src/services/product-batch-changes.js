const ProductBatch = require('../models/ProductBatch');
const { nextBatchCode } = require('./batch-code.service');
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
    if (!valid({ ...row, batch_code: row.batch_code || 'AUTO' }) || !skus.has(row.variant_sku)) throw batchError('Each batch needs a current variant SKU, positive whole quantity and valid dates.');
    if (inputRow.id != null) {
      if (!row.batch_code || codes.has(row.batch_code)) throw batchError('Each existing batch needs a unique code.');
      codes.add(row.batch_code);
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
  const records = await ProductBatch.find({ product_id: productId }).session(session).lean();
  for (const operation of changes.upserts.filter(row => !row.id)) {
    if (records.some(row => row.receipt_key === operation.client_id)) throw batchError('This receipt was already published. Reload the product before continuing.', 409);
  }
  const current = records.filter(row => !row.removed_at);
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
    .concat(changes.upserts.filter(row => !row.id && row.batch_code).map(row => row.batch_code));
  if (new Set(finalCodes).size !== finalCodes.length) throw batchError('Batch code already exists for this product.', 409);
  const finalSkus = current.filter(row => !removedIds.has(String(row._id))).map(row => updated.get(String(row._id))?.variant_sku || row.variant_sku)
    .concat(changes.upserts.filter(row => !row.id).map(row => row.variant_sku));
  if (variants && finalSkus.some(sku => !variants.some(variant => variant.sku === sku))) throw batchError('A batch refers to a removed variant. Edit or remove that batch before publishing.');

  const adjust = (sku, quantity) => {
    const variant = variants?.find(row => row.sku === sku);
    if (!variant || !Number.isSafeInteger(variant.stock + quantity) || variant.stock + quantity < 0) throw batchError('This batch change would make stock invalid.', 409);
    variant.stock += quantity;
  };
  for (const operation of [...changes.upserts.filter(row => row.id), ...changes.deletes]) {
    const original = byId.get(operation.id);
    const deleting = changes.deletes.includes(operation);
    if (!deleting && operation.batch_code !== original.batch_code) throw batchError('Published batch codes cannot be changed.');
    const quantityChanged = deleting || operation.quantity !== original.quantity || operation.variant_sku !== original.variant_sku;
    if (!quantityChanged) continue;
    if (!original.stock_applied) {
      if (!deleting) throw batchError('Legacy batches do not manage stock. Add a new receipt instead of changing their SKU or quantity.');
      continue;
    }
    const variant = variants?.find(row => row.sku === original.variant_sku);
    if (!variant || (variant.inventory_revision || 0) !== (original.inventory_revision || 0)) throw batchError('This SKU has had sales, reservations or returns since receipt. Its batch quantity cannot be edited or removed.', 409);
    adjust(original.variant_sku, -original.quantity);
    if (!deleting) adjust(operation.variant_sku, operation.quantity);
  }
  for (const operation of changes.upserts.filter(row => !row.id)) adjust(operation.variant_sku, operation.quantity);

  const events = [];
  for (const operation of changes.deletes) {
    await ProductBatch.updateOne({ _id: operation.id, product_id: productId }, { $set: { removed_at: new Date() } }, { session });
    events.push({ actionType: 'product.batch-delete', oldValue: operation.expected, newValue: null });
  }
  for (const operation of changes.upserts) {
    if (operation.id) {
      const original = byId.get(operation.id);
      const inventory_revision = operation.variant_sku === original.variant_sku ? original.inventory_revision
        : variants?.find(row => row.sku === operation.variant_sku)?.inventory_revision || 0;
      await ProductBatch.updateOne({ _id: operation.id, product_id: productId }, { $set: { ...asDates(operation), inventory_revision } }, { session, runValidators: true });
      events.push({ actionType: 'product.batch-update', oldValue: operation.expected, newValue: values(operation) });
    } else {
      const saved = { ...operation, batch_code: operation.batch_code || await nextBatchCode() };
      await ProductBatch.create([{ product_id: productId, ...asDates(saved), stock_applied: true, receipt_key: operation.client_id,
        inventory_revision: variants?.find(row => row.sku === operation.variant_sku)?.inventory_revision || 0, added_by: String(actor.user_id),
        added_by_name: String(actor.profile_name || actor.email || actor.user_id).slice(0, 120) }], { session });
      events.push({ actionType: 'product.batch-create', oldValue: null, newValue: values(saved) });
    }
  }
  return events;
}

module.exports = { normalizeBatchChanges, presentBatch, applyBatchChanges };
