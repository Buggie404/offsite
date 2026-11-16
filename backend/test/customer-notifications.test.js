const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const Notification = require('../src/models/Notification');
const registry = require('../src/services/notification.registry');

function load(file, mocks) {
  const filename = path.resolve(__dirname, file), realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

test('every customer event has a valid payload without a fabricated post id and a specific UI icon', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/app/shared/components/navbar/navbar.component.html'), 'utf8');
  for (const type of Object.keys(registry)) {
    const doc = new Notification({ notification_id: 'NTF-test', recipient_id: 'USR1', type, message: 'Update' });
    assert.equal(doc.validateSync(), undefined, type);
    assert.ok(html.includes(`*ngSwitchCase="'${type}'"`), `Missing icon: ${type}`);
  }
});

test('concurrent notifications get distinct IDs; event keys deduplicate even after deletion', async () => {
  const rows = [];
  class Store {
    constructor(data) { Object.assign(this, data); }
    async save() {
      if (this.event_key && rows.some(row => row.event_key === this.event_key)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      rows.push(this); return this;
    }
    static async findOneAndUpdate(query, update) {
      const row = rows.find(row => row.notification_id === query.notification_id && row.recipient_id === query.recipient_id && !row.is_deleted);
      if (row) Object.assign(row, update.$set); return row;
    }
  }
  const api = load('../src/services/notification.service.js', { '../models/Notification': Store });
  const payload = { recipient_id: 'USR1', type: 'FOLLOW_RECEIVED', event_key: 'follow:F1' };
  await Promise.all([api.createNotification(payload), api.createNotification(payload), api.createNotification({ ...payload, event_key: 'follow:F2' })]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].notification_id, rows[1].notification_id);
  assert.equal(await api.deleteNotification(rows[0].notification_id, 'OTHER'), undefined);
  await api.deleteNotification(rows[0].notification_id, 'USR1');
  await api.createNotification(payload);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].is_deleted, true);
});

test('a duplicate follow does not send a notification or increment counters twice', async () => {
  let created = false, updates = 0;
  const notices = [];
  const api = load('../src/services/follow.service.js', {
    '../models/Follow': { create: async () => {
      if (created) throw Object.assign(new Error('exists'), { code: 11000 });
      created = true; return { _id: 'F1' };
    } },
    '../models/User': { updateOne: async () => { updates++; }, findOne: () => ({ lean: async () => ({ user_id: 'USR1', community_name: 'Tea' }) }) },
    './notification.service': { notifyEvent: async event => { notices.push(event); return true; } }
  });
  assert.equal(await api.follow('USR1', 'USR2'), true);
  assert.equal(await api.follow('USR1', 'USR2'), false);
  assert.equal(updates, 2);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].recipient_id, 'USR2');
  assert.equal(notices[0].target_id, 'USR1');
});

test('reward notices distinguish pending, available, reversed and spent points', () => {
  const api = require('../src/services/notification-jobs.service');
  for (const [status, expected] of Object.entries({ pending: 'POINTS_PENDING', posted: 'POINTS_POSTED', reversed: 'POINTS_REVERSED', used: 'POINTS_USED' })) {
    const notice = api.pointNotice({ transaction_id: 'P1', user_id: 'USR1', status, amount: 10, type: 'review' });
    assert.equal(notice.type, expected);
    assert.equal(notice.target_type, 'rewards');
    assert.ok(notice.event_key.includes(status));
  }
  assert.equal(api.pointNotice({ status: 'posted', amount: -10 }).type, 'POINTS_USED');
  assert.equal(api.pointNotice({ status: 'posted', amount: 0 }), null);
});

test('consumption reminder requires repeat purchases and reaches the 85% interval threshold', () => {
  const { consumptionDue } = require('../src/services/notification-jobs.service');
  const dates = ['2026-10-01', '2026-10-11'];
  assert.equal(consumptionDue(dates.slice(0, 1), new Date('2026-10-25')), false);
  assert.equal(consumptionDue(dates, new Date('2026-10-19')), false);
  assert.equal(consumptionDue(dates, new Date('2026-10-20')), true);
  assert.equal(consumptionDue(['2026-10-01', '2026-10-01'], new Date('2026-10-25')), false);
});

test('voucher expiry follows Vietnam calendar days and excludes used vouchers', async () => {
  const events = [];
  const base = { _id: 'V1', assigned_user_id: 'USR1', code: 'WELCOME', createdAt: '2026-11-15T00:00:00Z',
    valid_from: '2026-11-01', valid_to: '2026-11-16', is_active: true, used_count: 0, usage_limit: 1 };
  const api = load('../src/services/notification-jobs.service.js', {
    '../models/Voucher': { find: () => ({ cursor: () => [base, { ...base, _id: 'V2', used_count: 1 }] }) },
    './notification.service': { notifyEvent: async event => { events.push(event); return true; } }
  });
  await api.voucherNotices(new Date('2026-11-14'), new Date('2026-11-16T16:00:00Z'));
  assert.deepEqual(events.map(event => event.type), ['VOUCHER_RECEIVED', 'VOUCHER_EXPIRING']);
  events.length = 0;
  await api.voucherNotices(new Date('2026-11-14'), new Date('2026-11-16T17:01:00Z'));
  assert.deepEqual(events.map(event => event.type), ['VOUCHER_EXPIRED']);
});

test('a failed reward delivery stays eligible for retry and marker does not alter transaction timestamps', async () => {
  let success = false;
  const writes = [];
  const txn = { _id: 'T1', transaction_id: 'PTX1', user_id: 'USR1', status: 'posted', type: 'review', amount: 1, updated_at: new Date() };
  const api = load('../src/services/notification-jobs.service.js', {
    '../models/PointTransaction': { find: () => ({ sort: () => ({ cursor: () => [txn] }) }),
      updateOne: async (...args) => { writes.push(args); } },
    './notification.service': { notifyEvent: async () => success },
    './loyalty.service': { computeLifetimePoints: async () => 1, syncMembershipTier: async () => 'Seed' }
  });
  await api.rewardNotices(new Date());
  assert.equal(writes.length, 0);
  success = true;
  await api.rewardNotices(new Date());
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0][0], { _id: 'T1', updated_at: txn.updated_at });
  assert.deepEqual(writes[0][2], { timestamps: false });
});

test('consumption reminders respect opt-out and skip products already in a Ritual Box', async () => {
  const events = [], subscriptionQueries = [];
  const api = load('../src/services/notification-jobs.service.js', {
    '../models/Order': { aggregate: async () => ['USR1', 'USR2'].map(user => ({ _id: { user, product: '507f1f77bcf86cd799439011' }, dates: ['2026-10-01', '2026-10-15'] })) },
    '../models/User': { findOne: query => ({ lean: async () => ({ notification_preferences: { consumption_reminder: query.user_id !== 'USR2' } }) }) },
    '../models/Product': { findOne: () => ({ lean: async () => ({ _id: '507f1f77bcf86cd799439011', product_id: 1, name: 'Coffee', category: 'coffee', is_active: true }) }) },
    '../models/Subscription': { exists: async query => { subscriptionQueries.push(query); return true; } },
    './notification.service': { notifyEvent: async event => { events.push(event); return true; } }
  });
  await api.consumptionNotices(new Date('2026-11-16'));
  assert.equal(events.length, 0);
  assert.equal(subscriptionQueries.length, 1);
  assert.deepEqual(subscriptionQueries[0].product_id.$in, ['507f1f77bcf86cd799439011', '1']);
});

test('membership notifications only upgrade a tier and do not repeat when the dashboard refreshes', async () => {
  let tier = 'Zen';
  const events = [];
  const api = load('../src/services/loyalty.service.js', {
    '../models/User': {
      findOneAndUpdate: (query, update) => ({ lean: async () => {
        if (!query.membership_tier.$in.includes(tier)) return null;
        const before = { membership_tier: tier };
        tier = update.$set.membership_tier; return before;
      } }),
      findOne: () => ({ lean: async () => ({ membership_tier: tier }) })
    },
    './notification.service': { notifyEvent: async event => { events.push(event); return true; } }
  });
  assert.equal(await api.syncMembershipTier('USR1', 0), 'Zen');
  assert.equal(events.length, 0);
  tier = 'Seed';
  assert.equal(await api.syncMembershipTier('USR1', 400), 'Bloom');
  assert.equal(await api.syncMembershipTier('USR1', 400), 'Bloom');
  assert.equal(events.length, 1);
});

test('order reconciliation ignores old status history and uses the same event keys as inline notifications', async () => {
  const events = [];
  const api = load('../src/services/notification-jobs.service.js', {
    '../models/Order': { find: () => ({ cursor: () => [{ user_id: 'USR1', order_id: 'O1', order_status: 'delivered',
      updated_at: new Date('2026-11-16'), status_history: [
        { status: 'processing', changed_at: new Date('2026-10-01') },
        { status: 'delivered', changed_at: new Date('2026-11-16') }
      ] }] }) },
    './notification.service': { notifyEvent: async event => { events.push(event); return true; } }
  });
  await api.orderNotices(new Date('2026-11-15'));
  assert.equal(events.length, 1);
  assert.equal(events[0].event_key, 'delivered:O1');
  assert.equal(events[0].target_id, 'O1');
});

test('a failed notice does not mark a points change as announced, allowing the next job to retry', async () => {
  const marks = [], txn = { _id: 'T', transaction_id: 'P1', user_id: 'USR1', status: 'pending', amount: 10, updated_at: new Date() };
  let success = false;
  const api = load('../src/services/notification-jobs.service.js', {
    '../models/PointTransaction': { find: () => ({ sort: () => ({ cursor: async function* () { yield txn; } }) }), updateOne: async (...args) => marks.push(args) },
    './notification.service': { notifyEvent: async () => success },
    './loyalty.service': { computeLifetimePoints: async () => 10, syncMembershipTier: async () => 'Seed' }
  });
  await api.rewardNotices(new Date(0)); assert.equal(marks.length, 0);
  success = true;
  await api.rewardNotices(new Date(0)); assert.equal(marks.length, 1);
  assert.equal(marks[0][2].timestamps, false);
});
