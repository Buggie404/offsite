const Product = require('../models/Product');
const ProductDraft = require('../models/ProductDraft');
const ProductIdSequence = require('../models/ProductIdSequence');
const ProductBatch = require('../models/ProductBatch');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const { vnDateKey } = require('../services/pantry.logic');

const CATEGORIES = ['matcha', 'coffee', 'drinkware', 'sets_bundles', 'tools'];
const VARIANT_TYPES = ['none', 'size', 'color', 'type', 'package'];

function text(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function optionalText(value, max = 500) {
  const normalized = text(value, max);
  return normalized || undefined;
}

function roastValue(value) {
  const raw = optionalText(value);
  if (!raw) return undefined;
  const level = raw.toLowerCase().replace(/-/g, ' ').replace(/\s+roast$/, '').trim();
  return ['light', 'medium light', 'medium', 'medium dark', 'dark'].includes(level) ? `${level} roast` : raw;
}

function bool(value) {
  return value === true;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBatchDate(value) {
  if (value == null || value === '') return { date: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'batch_expiry_date must be YYYY-MM-DD' };
  }
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return { error: 'batch_expiry_date is invalid' };
  return { date };
}

function cleanImage(image, index) {
  const url = text(image?.url, 2000);
  if (!url) return null;
  return {
    url,
    public_id: text(image?.public_id, 500) || `admin-image-${Date.now()}-${index}`,
    sort_order: Math.max(0, Math.trunc(finiteNumber(image?.sort_order, index))),
    alt_text: text(image?.alt_text, 300)
  };
}

function cleanVariant(variant, existingVariant) {
  const sku = text(variant?.sku, 100);
  return {
    sku,
    label: text(variant?.label, 120),
    price: finiteNumber(variant?.price, -1),
    stock: Math.trunc(finiteNumber(variant?.stock, -1)),
    low_stock_threshold: variant?.low_stock_threshold == null || variant.low_stock_threshold === ''
      ? (existingVariant?.low_stock_threshold ?? 10)
      : Math.trunc(finiteNumber(variant.low_stock_threshold, -1)),
    sold_quantity: existingVariant?.sold_quantity || 0,
    is_default: bool(variant?.is_default),
    images: (Array.isArray(variant?.images) ? variant.images : []).map(cleanImage).filter(Boolean)
  };
}

function cleanComposition(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) return entry;
    return text(entry, 500);
  }).filter(Boolean);
}

function buildPayload(body, existing = null) {
  const category = text(body?.category, 50);
  const parsedBatch = parseBatchDate(body?.batch_expiry_date);
  if (parsedBatch.error) return { error: parsedBatch.error };
  const images = (Array.isArray(body?.images) ? body.images : []).map(cleanImage).filter(Boolean);
  const existingVariants = new Map((existing?.variants || []).map((variant) => [variant.sku, variant]));
  const variants = (Array.isArray(body?.variants) ? body.variants : [])
    .map((variant) => cleanVariant(variant, existingVariants.get(text(variant?.sku, 100))));
  const errors = [];
  if (!text(body?.name, 200)) errors.push('Product name is required.');
  if (!text(body?.slug, 220)) errors.push('Slug is required.');
  if (!CATEGORIES.includes(category)) errors.push('Choose a valid category.');
  const variantType = text(body?.variant_type, 20);
  if (!VARIANT_TYPES.includes(variantType)) errors.push('Choose a valid variant type.');
  if (!variants.length) errors.push('Add at least one variant.');
  if (variants.some((variant) => !variant.sku)) errors.push('Every variant needs a SKU.');
  if (new Set(variants.map((variant) => variant.sku.toLowerCase())).size !== variants.length) errors.push('Variant SKUs must be unique.');
  if (variants.some((variant) => variant.price <= 0)) errors.push('Variant prices must be greater than 0.');
  if (variants.some((variant) => variant.stock < 0)) errors.push('Variant stock cannot be negative.');
  if (variants.some((variant) => variant.low_stock_threshold < 0)) errors.push('Low-stock threshold cannot be negative.');
  if (variants.filter((variant) => variant.is_default).length !== 1) errors.push('Choose exactly one default variant.');
  const discount = body?.subscribe_discount_percent == null || body.subscribe_discount_percent === ''
    ? null : finiteNumber(body.subscribe_discount_percent, NaN);
  if (discount != null && (!Number.isInteger(discount) || discount < 5 || discount > 15)) {
    errors.push('Subscription discount must be a whole number from 5 to 15.');
  }
  if (errors.length) return { error: errors[0], errors };
  const previousBatchKey = existing?.batch_expiry_date ? vnDateKey(existing.batch_expiry_date) : null;
  const nextBatchKey = parsedBatch.date ? vnDateKey(parsedBatch.date) : null;
  const batchChanged = previousBatchKey !== nextBatchKey;
  return { payload: {
    name: text(body.name, 200),
    slug: text(body.slug, 220).toLowerCase(),
    description: text(body.description, 10000),
    seo_title: text(body.seo_title, 300),
    category,
    product_tag: [...new Set((Array.isArray(body.product_tag) ? body.product_tag : []).map((tag) => text(tag, 80)).filter(Boolean))],
    is_subscription: bool(body.is_subscription),
    is_best_seller: bool(body.is_best_seller),
    is_new_arrival: bool(body.is_new_arrival),
    is_subscribable: bool(body.is_subscribable),
    subscribe_discount_percent: discount,
    variant_type: text(body.variant_type, 20),
    images,
    variants,
    is_active: body.is_active !== false,
    quiz_eligible: body.quiz_eligible !== false,
    batch_expiry_date: parsedBatch.date,
    batch_expiry_set_at: batchChanged ? (parsedBatch.date ? new Date() : null) : (existing?.batch_expiry_set_at || null),
    matcha: category === 'matcha' ? {
      product_grade: optionalText(body.matcha?.product_grade), origin: optionalText(body.matcha?.origin),
      pricing_tier: optionalText(body.matcha?.pricing_tier)
    } : undefined,
    coffee: category === 'coffee' ? {
      roast_level: roastValue(body.coffee?.roast_level), process_type: optionalText(body.coffee?.process_type),
      product_origin: optionalText(body.coffee?.product_origin),
      tasting_notes: (Array.isArray(body.coffee?.tasting_notes) ? body.coffee.tasting_notes : []).map((note) => text(note, 100)).filter(Boolean)
    } : undefined,
    drinkware: category === 'drinkware' ? {
      ware_type: optionalText(body.drinkware?.ware_type), material: optionalText(body.drinkware?.material),
      product_size: optionalText(body.drinkware?.product_size)
    } : undefined,
    sets_bundles: category === 'sets_bundles' ? {
      set_type: optionalText(body.sets_bundles?.set_type), is_exclusive: bool(body.sets_bundles?.is_exclusive),
      composition: cleanComposition(body.sets_bundles?.composition)
    } : undefined,
    tools: category === 'tools' ? {
      tool_category: optionalText(body.tools?.tool_category), tool_type: optionalText(body.tools?.tool_type)
    } : undefined
  } };
}

function presentProduct(product) {
  const value = typeof product.toObject === 'function' ? product.toObject() : product;
  return { ...value,
    batch_expiry_date: value.batch_expiry_date ? vnDateKey(value.batch_expiry_date) : null,
    batch_expiry_set_at: value.batch_expiry_set_at || null
  };
}

function duplicateError(error) {
  if (error?.code !== 11000) return null;
  if (error.keyPattern?.slug) return 'That slug is already used by another product.';
  if (error.keyPattern?.product_id) return 'That product id is already used.';
  return 'A product with the same unique value already exists.';
}

function validationError(error) {
  if (error?.name !== 'ValidationError') return null;
  return Object.values(error.errors || {}).map((issue) => issue.message).join(' ') || error.message;
}

async function nextProductId() {
  const [last, draft] = await Promise.all([
    Product.findOne({}, 'product_id').sort({ product_id: -1 }).lean(),
    ProductDraft.findOne({}, 'product_id').sort({ product_id: -1 }).lean()
  ]);
  try {
    await ProductIdSequence.updateOne({ _id: 'products' }, { $max: { value: Math.max(last?.product_id || 10000, draft?.product_id || 10000) } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const sequence = await ProductIdSequence.findOneAndUpdate({ _id: 'products' }, { $inc: { value: 1 } }, { new: true }).lean();
  return sequence.value;
}

function editorProduct(product, draft) {
  const value = product || { product_id: draft.product_id, createdAt: draft.created_at, updatedAt: draft.saved_at,
    total_sold_quantity: 0, rating_avg: null, review_count: 0 };
  return presentProduct({ ...value, ...(draft?.payload || {}), is_active: product?.is_active === true,
    is_new_product: !product, has_draft: !!draft, draft_saved_at: draft?.saved_at || null });
}

async function listProducts(req, res) {
  try {
    // Keep the list response small; the editor loads the complete document by product_id.
    const products = await Product.find({}, {
      _id: 0, product_id: 1, name: 1, slug: 1, category: 1, product_tag: 1,
      is_active: 1, is_best_seller: 1, is_new_arrival: 1,
      'images.url': 1, 'images.sort_order': 1, 'images.alt_text': 1,
      'variants.sku': 1, 'variants.price': 1, 'variants.stock': 1, 'variants.is_default': 1, 'variants.low_stock_threshold': 1
    }).sort({ product_id: 1 }).lean();
    res.json({ data: products, total: products.length });
  } catch (error) {
    console.error('Error listing products for admin:', error);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
}

async function getProduct(req, res) {
  try {
    const product = await Product.findOne({ product_id: Number(req.params.productId) }).lean();
    const draft = await ProductDraft.findOne({ product_id: Number(req.params.productId) }).lean();
    if (!product && !draft) return res.status(404).json({ error: 'Product not found' });
    res.json({ data: editorProduct(product, draft) });
  } catch (error) {
    console.error('Error loading admin product:', error);
    res.status(500).json({ error: 'Failed to retrieve product' });
  }
}

async function listDrafts(req, res) {
  try {
    const drafts = await ProductDraft.find({}).sort({ saved_at: -1 }).lean();
    const products = drafts.length ? await Product.find({ product_id: { $in: drafts.map(draft => draft.product_id) } }, 'product_id is_active').lean() : [];
    const byId = new Map(products.map(product => [product.product_id, product]));
    const data = drafts.map(draft => {
      const payload = draft.payload;
      const live = byId.get(draft.product_id);
      return { product_id: draft.product_id, name: payload.name, slug: payload.slug, category: payload.category,
        product_tag: payload.product_tag || [], is_best_seller: payload.is_best_seller, is_new_arrival: payload.is_new_arrival,
        images: (payload.images || []).map(({ url, sort_order, alt_text }) => ({ url, sort_order, alt_text })),
        variants: (payload.variants || []).map(({ sku, price, stock, is_default, low_stock_threshold }) => ({ sku, price, stock, is_default, low_stock_threshold })),
        is_active: live?.is_active === true, is_new_product: !live, has_draft: true, draft_saved_at: draft.saved_at };
    });
    res.json({ data, total: data.length });
  } catch (error) {
    console.error('Error listing product drafts:', error);
    res.status(500).json({ error: 'Failed to retrieve product drafts' });
  }
}

async function discardDraft(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Invalid product id.' });
    const draft = await ProductDraft.findOneAndDelete({ product_id: productId }).lean();
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    await req.writeActivityLog({ actionType: 'product.draft-discard', targetEntity: 'Products', targetId: String(productId),
      oldValue: { name: draft.payload.name }, newValue: null });
    res.json({ data: { product_id: productId } });
  } catch (error) {
    console.error('Error discarding product draft:', error);
    res.status(500).json({ error: 'Failed to discard product draft' });
  }
}

async function publishDraft(req, res) {
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Invalid product id.' });
  try {
    const draft = await ProductDraft.findOne({ product_id: productId }).lean();
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    req.body = draft.payload;
    return updateProduct(req, res);
  } catch (error) {
    console.error('Error publishing product draft:', error);
    res.status(500).json({ error: 'Failed to publish product draft' });
  }
}

async function saveDraft(req, res) {
  try {
    const id = req.params.productId == null ? null : Number(req.params.productId);
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) return res.status(400).json({ error: 'Invalid product id.' });
    const product = id === null ? null : await Product.findOne({ product_id: id }).lean();
    if (id !== null && !product && !await ProductDraft.exists({ product_id: id })) return res.status(404).json({ error: 'Product not found' });
    const built = buildPayload(req.body, product);
    if (built.error) return res.status(400).json({ error: built.error, errors: built.errors });
    // A draft has no authority to change the storefront visibility.
    delete built.payload.is_active;
    const productId = id ?? await nextProductId();
    const draft = await ProductDraft.findOneAndUpdate({ product_id: productId },
      { $set: { payload: built.payload, saved_by: String(req.user.user_id), saved_at: new Date() } },
      { upsert: true, new: true, runValidators: true }).lean();
    await req.writeActivityLog({ actionType: 'product.draft-save', targetEntity: 'Products', targetId: String(productId),
      oldValue: null, newValue: { name: built.payload.name } });
    res.json({ data: editorProduct(product, draft) });
  } catch (error) {
    const conflict = duplicateError(error);
    if (conflict) return res.status(409).json({ error: conflict });
    console.error('Error saving product draft:', error);
    res.status(500).json({ error: 'Failed to save product draft' });
  }
}

async function listBatches(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Invalid product id.' });
    const rows = await ProductBatch.find({ product_id: productId }).sort({ received_at: -1, created_at: -1 }).lean();
    res.json({ data: rows });
  } catch (error) {
    console.error('Error listing product batches:', error);
    res.status(500).json({ error: 'Failed to retrieve product batches' });
  }
}

async function addBatch(req, res) {
  try {
    const productId = Number(req.params.productId);
    const product = Number.isSafeInteger(productId) && productId > 0
      ? await Product.findOne({ product_id: productId }, 'product_id variants.sku') : null;
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const batchCode = text(req.body?.batch_code, 80);
    const variantSku = text(req.body?.variant_sku, 100);
    const quantity = Number(req.body?.quantity);
    const receivedAt = parseBatchDate(req.body?.received_at);
    const bestBefore = parseBatchDate(req.body?.best_before);
    if (!batchCode || !product.variants.some((variant) => variant.sku === variantSku)
      || !Number.isSafeInteger(quantity) || quantity < 1 || !receivedAt.date || receivedAt.error || bestBefore.error
      || (bestBefore.date && bestBefore.date < receivedAt.date)) {
      return res.status(400).json({ error: 'Enter a batch code, valid SKU, positive quantity, received date and valid best-before date.' });
    }
    const actor = req.user?.user_id;
    const row = await ProductBatch.create({ batch_code: batchCode, product_id: productId,
      variant_sku: variantSku, quantity, received_at: receivedAt.date, best_before: bestBefore.date,
      added_by: actor, added_by_name: text(req.user?.profile_name || req.user?.email || actor, 120) });
    await req.writeActivityLog({ actionType: 'product.batch-create', targetEntity: 'Products', targetId: String(productId),
      oldValue: null, newValue: { batch_code: batchCode, variant_sku: variantSku, quantity, best_before: bestBefore.date } });
    res.status(201).json({ data: row });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Batch code already exists for this product.' });
    console.error('Error creating product batch:', error);
    res.status(500).json({ error: 'Failed to create product batch' });
  }
}

async function updateBatchBestBefore(req, res) {
  try {
    const productId = Number(req.params.productId);
    const parsed = parseBatchDate(req.body?.best_before);
    if (!Number.isSafeInteger(productId) || productId <= 0 || parsed.error) {
      return res.status(400).json({ error: parsed.error || 'Invalid product id.' });
    }
    const row = await ProductBatch.findOne({ _id: req.params.batchId, product_id: productId });
    if (!row) return res.status(404).json({ error: 'Batch not found.' });
    if (parsed.date && parsed.date < row.received_at) return res.status(400).json({ error: 'Best-before date cannot precede received date.' });
    const previous = row.best_before;
    row.best_before = parsed.date;
    await row.save();
    await req.writeActivityLog({ actionType: 'product.batch-expiry', targetEntity: 'Products', targetId: String(productId),
      oldValue: { batch_code: row.batch_code, best_before: previous },
      newValue: { batch_code: row.batch_code, best_before: row.best_before } });
    res.json({ data: row });
  } catch (error) {
    console.error('Error updating batch best-before:', error);
    res.status(500).json({ error: 'Failed to update batch best-before' });
  }
}

async function productHistory(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: 'Invalid product id.' });
    const rows = await ActivityLog.find({ target_entity: 'Products', target_id: String(productId) })
      .sort({ created_at: -1 }).limit(5).select('action_type old_value new_value created_at admin_id').lean();
    const actorIds = [...new Set(rows.map((row) => row.admin_id))];
    const objectIds = actorIds.filter((id) => /^[a-f0-9]{24}$/i.test(id));
    const actors = actorIds.length ? await User.find({ $or: [{ _id: { $in: objectIds } }, { user_id: { $in: actorIds } }] },
      'user_id profile_name email').lean() : [];
    const names = new Map(actors.flatMap((actor) => [[String(actor._id), actor.profile_name || actor.email],
      [actor.user_id, actor.profile_name || actor.email]]));
    res.json({ data: rows.map((row) => ({ ...row, actor_name: names.get(row.admin_id) || 'Admin' })) });
  } catch (error) {
    console.error('Error loading product history:', error);
    res.status(500).json({ error: 'Failed to retrieve product history' });
  }
}

async function createProduct(req, res) {
  try {
    const built = buildPayload(req.body);
    if (built.error) return res.status(400).json({ error: built.error, errors: built.errors });
    const now = new Date().toISOString();
    const product = await Product.create({ ...built.payload, product_id: await nextProductId(),
      total_sold_quantity: 0, rating_avg: null, review_count: 0, createdAt: now, updatedAt: now });
    await req.writeActivityLog({ actionType: 'product.create', targetEntity: 'Products', targetId: String(product.product_id),
      oldValue: null, newValue: { name: product.name, category: product.category, is_active: product.is_active } });
    res.status(201).json({ data: presentProduct(product) });
  } catch (error) {
    const conflict = duplicateError(error);
    if (conflict) return res.status(409).json({ error: conflict });
    const invalid = validationError(error);
    if (invalid) return res.status(400).json({ error: invalid });
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
}

async function updateProduct(req, res) {
  try {
    const product = await Product.findOne({ product_id: Number(req.params.productId) });
    if (!product) {
      const draft = await ProductDraft.findOne({ product_id: Number(req.params.productId) }).lean();
      if (!draft) return res.status(404).json({ error: 'Product not found' });
      const built = buildPayload(req.body);
      if (built.error) return res.status(400).json({ error: built.error, errors: built.errors });
      const now = new Date().toISOString();
      const created = await Product.create({ ...built.payload, product_id: draft.product_id, is_active: true,
        total_sold_quantity: 0, rating_avg: null, review_count: 0, createdAt: now, updatedAt: now });
      await ProductDraft.deleteOne({ product_id: draft.product_id });
      await req.writeActivityLog({ actionType: 'product.create', targetEntity: 'Products', targetId: String(created.product_id),
        oldValue: null, newValue: { name: created.name, is_active: true } });
      return res.json({ data: presentProduct(created) });
    }
    const built = buildPayload(req.body, product);
    if (built.error) return res.status(400).json({ error: built.error, errors: built.errors });
    // Publishing content and changing storefront visibility are separate admin actions.
    built.payload.is_active = product.is_active;
    const previous = presentProduct(product);
    Object.assign(product, built.payload, { updatedAt: new Date().toISOString() });
    await product.save();
    await ProductDraft.deleteOne({ product_id: product.product_id });
    await req.writeActivityLog({ actionType: 'product.update', targetEntity: 'Products', targetId: String(product.product_id),
      oldValue: { name: previous.name, category: previous.category, is_active: previous.is_active,
        price: previous.variants?.find((variant) => variant.is_default)?.price ?? previous.variants?.[0]?.price ?? null },
      newValue: { name: product.name, category: product.category, is_active: product.is_active,
        price: product.variants?.find((variant) => variant.is_default)?.price ?? product.variants?.[0]?.price ?? null } });
    res.json({ data: presentProduct(product) });
  } catch (error) {
    const conflict = duplicateError(error);
    if (conflict) return res.status(409).json({ error: conflict });
    const invalid = validationError(error);
    if (invalid) return res.status(400).json({ error: invalid });
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
}

async function updateStatus(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0 || typeof req.body?.is_active !== 'boolean') {
      return res.status(400).json({ error: 'Provide a valid product id and active status.' });
    }
    // A status-only edit must not validate/rewrite legacy images, variants or inventory.
    const updatedAt = new Date().toISOString();
    const product = await Product.findOneAndUpdate(
      { product_id: productId },
      { $set: { is_active: req.body.is_active, updatedAt } },
      { new: false, runValidators: true }
    ).lean();
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const previous = product.is_active;
    product.is_active = req.body.is_active;
    product.updatedAt = updatedAt;
    await req.writeActivityLog({ actionType: 'product.status', targetEntity: 'Products', targetId: String(product.product_id),
      oldValue: { is_active: previous }, newValue: { is_active: product.is_active } });
    res.json({ data: presentProduct(product) });
  } catch (error) {
    console.error('Error updating product status:', error);
    res.status(500).json({ error: 'Failed to update product status' });
  }
}

async function updateStatuses(req, res) {
  try {
    const changes = req.body?.changes;
    if (!Array.isArray(changes) || !changes.length || changes.length > 100
      || changes.some((item) => !Number.isSafeInteger(item?.product_id) || item.product_id <= 0 || typeof item.is_active !== 'boolean')
      || new Set(changes.map((item) => item.product_id)).size !== changes.length) {
      return res.status(400).json({ error: 'Provide 1–100 unique products with a valid active status.' });
    }
    const ids = changes.map((item) => item.product_id);
    const existing = await Product.find({ product_id: { $in: ids } }, 'product_id is_active').lean();
    if (existing.length !== ids.length) return res.status(404).json({ error: 'One or more products no longer exist. Reload the list.' });
    const previousById = new Map(existing.map((item) => [item.product_id, item.is_active]));
    const changed = changes.filter((item) => previousById.get(item.product_id) !== item.is_active);
    if (changed.length) {
      const updatedAt = new Date().toISOString();
      await Product.bulkWrite(changed.map((item) => ({
        updateOne: {
          filter: { product_id: item.product_id },
          update: { $set: { is_active: item.is_active, updatedAt } }
        }
      })));
      await Promise.all(changed.map((item) => req.writeActivityLog({
        actionType: 'product.status', targetEntity: 'Products', targetId: String(item.product_id),
        oldValue: { is_active: previousById.get(item.product_id) }, newValue: { is_active: item.is_active }
      })));
    }
    res.json({ data: changes });
  } catch (error) {
    console.error('Error updating product statuses:', error);
    res.status(500).json({ error: 'Failed to update product statuses' });
  }
}

async function updateBatchExpiry(req, res) {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: 'Invalid product id' });
    const parsed = parseBatchDate(req.body?.batch_expiry_date);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const product = await Product.findOne({ product_id: productId });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const previous = presentProduct(product);
    const nextKey = parsed.date ? vnDateKey(parsed.date) : null;
    if (nextKey !== previous.batch_expiry_date) {
      product.batch_expiry_date = parsed.date;
      product.batch_expiry_set_at = parsed.date ? new Date() : null;
      product.updatedAt = new Date().toISOString();
      await req.writeActivityLog({ actionType: 'product.batch-expiry', targetEntity: 'Products', targetId: String(product.product_id),
        oldValue: { batch_expiry_date: previous.batch_expiry_date }, newValue: { batch_expiry_date: nextKey } });
      await product.save();
    }
    res.json({ data: presentProduct(product) });
  } catch (error) {
    console.error('Error updating batch expiry:', error);
    res.status(500).json({ error: 'Failed to update batch expiry' });
  }
}

module.exports = { listProducts, listDrafts, discardDraft, publishDraft, getProduct, saveDraft, listBatches, addBatch, updateBatchBestBefore, productHistory, createProduct, updateProduct, updateStatus, updateStatuses, updateBatchExpiry };
