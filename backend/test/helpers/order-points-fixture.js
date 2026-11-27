const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadService(name, mocks) {
  const file = path.resolve(__dirname, '../../src/services', name);
  const real = createRequire(file), mod = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    key => Object.hasOwn(mocks, key) ? mocks[key] : real(key), mod, mod.exports);
  return mod.exports;
}

function fixture(orders, options = {}) {
  let state = {
    orders: Object.fromEntries(Object.entries(orders).map(([id, row]) => [id, { _id: id, order_id: id, ...row }])),
    txns: options.txns || Object.keys(orders).map(id => ({
      _id: id, user_id: 'USR1', type: 'purchase', ref_type: 'order', ref_id: id,
      amount: 10, status: 'pending', created_at: new Date('2026-11-01T00:00:00Z')
    })),
    refunds: options.refunds || [], referrals: options.referrals || [],
    balance: { USR1: 0, ...(options.balance || {}) }
  };
  let version = 0, injected = false, attempts = 0, failedBalance = false;
  const read = session => session ? session.snapshot : state;
  const working = session => {
    if (!session?.snapshot) throw new Error('A shared MongoDB session is required');
    return session.snapshot;
  };
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(row[key]);
    return row[key] === value;
  });
  const query = getter => {
    let session;
    return {
      session(s) { session = s; return this; },
      lean: async () => structuredClone(getter(session)),
      then(resolve, reject) { return Promise.resolve(structuredClone(getter(session))).then(resolve, reject); }
    };
  };
  const update = (row, change) => {
    Object.assign(row, change.$set || {});
    for (const [key, amount] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + amount;
    for (const [key, entry] of Object.entries(change.$push || {})) (row[key] ||= []).push(entry);
  };
  const conflict = () => Object.assign(new Error('WriteConflict'), { transient: true });
  const session = () => ({
    async withTransaction(fn) {
      for (let retry = 0; retry < 5; retry++) {
        attempts++;
        this.baseVersion = version;
        this.snapshot = structuredClone(state);
        try {
          await fn();
          if (version !== this.baseVersion) throw conflict();
          state = this.snapshot;
          version++;
          // MongoDB driver bundled with Mongoose returns commit metadata, not callback values.
          return { ok: 1 };
        } catch (error) {
          if (!error.transient || retry === 4) throw error;
        }
      }
    },
    async endSession() {}
  });
  const beforeWrite = s => {
    if (!injected && options.beforeOrderWrite) {
      injected = true;
      options.beforeOrderWrite(api);
    }
    if (version !== s.baseVersion) throw conflict();
  };
  const Order = {
    db: {
      startSession: async () => session(),
      transaction: async fn => { const s = session(); try { return await s.withTransaction(() => fn(s)); } finally { await s.endSession(); } }
    },
    findOne: filter => query(s => Object.values(read(s).orders).find(row => matches(row, filter)) || null),
    updateOne: async (filter, change, { session: s }) => {
      beforeWrite(s);
      const row = Object.values(working(s).orders).find(row => matches(row, filter));
      if (!row) return { modifiedCount: 0 };
      update(row, change);
      return { modifiedCount: 1 };
    },
    findOneAndUpdate: async (filter, change, { session: s }) => {
      beforeWrite(s);
      const row = Object.values(working(s).orders).find(row => matches(row, filter));
      if (!row) return null;
      update(row, change);
      return structuredClone(row);
    }
  };
  const PointTransaction = {
    find: filter => query(s => read(s).txns.filter(row => matches(row, filter))),
    findOne: filter => query(s => read(s).txns.find(row => matches(row, filter)) || null),
    findOneAndUpdate: async (filter, change, { session: s }) => {
      const row = working(s).txns.find(row => matches(row, filter));
      if (!row) return null;
      update(row, change);
      return structuredClone(row);
    },
    updateOne: async (filter, change, { session: s }) => {
      const row = working(s).txns.find(row => matches(row, filter));
      if (!row) return { modifiedCount: 0 };
      update(row, change);
      return { modifiedCount: 1 };
    }
  };
  const RefundRequest = { findOne: filter => query(s => read(s).refunds.find(row => matches(row, filter)) || null) };
  const User = { updateOne: async (filter, change, { session: s }) => {
    if (options.failBalance && !failedBalance) { failedBalance = true; throw new Error('balance write failed'); }
    const balances = working(s).balance;
    balances[filter.user_id] = (balances[filter.user_id] || 0) + change.$inc.points;
    return { modifiedCount: 1 };
  }};
  const Referral = { updateOne: async (filter, change, { session: s }) => {
    const row = working(s).referrals.find(row => matches(row, filter));
    if (row) update(row, change);
    return { modifiedCount: row ? 1 : 0 };
  }};
  const models = {
    '../models/Order': Order, '../models/PointTransaction': PointTransaction,
    '../models/RefundRequest': RefundRequest, '../models/Referral': Referral, '../models/User': User
  };
  const settlement = loadService('order-point-settlement.service.js', models);
  const submission = loadService('refund-submission.service.js', models);
  const service = loadService('points.service.js', {
    ...models,
    './order-point-settlement.service': settlement,
    './community-restriction.service': { activeRestriction: () => null },
    './loyalty.service': { finalizeReferralOrderRewards: async () => {} }
  });
  const api = {
    service, settlement, submission,
    get txns() { return state.txns; }, get balance() { return state.balance; },
    get attempts() { return attempts; }, get state() { return state; },
    setOrderStatus(id, status, refundStatus) {
      state.orders[id].order_status = status;
      if (refundStatus) {
        let request = state.refunds.find(row => row.order_id === id);
        if (!request) state.refunds.push(request = { order_id: id });
        request.status = refundStatus;
      }
      version++;
    },
    requestDocument({ fail = false } = {}) {
      return { async save({ session: s }) {
        if (fail) throw new Error('request save failed');
        working(s).refunds.push({ order_id: Object.keys(state.orders)[0], status: 'pending' });
      }};
    }
  };
  return api;
}
module.exports = { fixture };
