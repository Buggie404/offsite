const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), module, module.exports);
  return module.exports;
}

const DAY = 86400000;
const NOW = new Date('2026-11-01T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY);

// reports: { created_at, status }, newest first, like the query sorts them.
function setup({ reports = [], warnedAt = null } = {}) {
  const calls = { notifications: [], since: null };
  const user = { report_warned_at: warnedAt };
  const service = load('../src/services/report-abuse.service.js', {
    '../models/Report': {
      countDocuments: async (query) => {
        calls.since = query.created_at.$gte;
        return reports.filter((r) => r.created_at >= query.created_at.$gte).length;
      },
      find: () => ({ sort: () => ({ limit: (n) => ({ lean: async () => reports.filter((r) => r.status !== 'pending').slice(0, n) }) }) })
    },
    '../models/User': {
      findOne: () => ({ lean: async () => user }),
      updateOne: async () => {
        if (user.report_warned_at) return { modifiedCount: 0 };
        user.report_warned_at = NOW;
        return { modifiedCount: 1 };
      }
    },
    './notification.service': { createNotification: async (n) => { calls.notifications.push(n); } }
  });
  return { service, calls, user };
}

const times = (count, report) => Array.from({ length: count }, () => ({ ...report }));

test('a customer can send 10 reports a day', async () => {
  const under = setup({ reports: times(9, { created_at: ago(0.1) }) });
  assert.equal(await under.service.reportLimitMessage('U1', NOW), null);

  const full = setup({ reports: times(10, { created_at: ago(0.1) }) });
  assert.match(await full.service.reportLimitMessage('U1', NOW), /10 reports a day/);

  const yesterday = setup({ reports: times(10, { created_at: ago(1.1) }) });
  assert.equal(await yesterday.service.reportLimitMessage('U1', NOW), null);
});

test('after the warning a customer can send 3 reports every 30 days, counted from the warning', async () => {
  const warnedAt = ago(10);
  const earlier = times(5, { created_at: ago(11) });

  const fresh = setup({ reports: earlier, warnedAt });
  assert.equal(await fresh.service.reportLimitMessage('U1', NOW), null);

  const used = setup({ reports: [...earlier, ...times(3, { created_at: ago(9) })], warnedAt });
  assert.match(await used.service.reportLimitMessage('U1', NOW), /3 reports every 30 days/);

  const later = setup({ reports: times(3, { created_at: ago(31) }), warnedAt: ago(40) });
  assert.equal(await later.service.reportLimitMessage('U1', NOW), null);
});

test('5 dismissed reports in a row bring one warning and no penalty', async () => {
  const { service, calls, user } = setup({ reports: times(5, { status: 'dismissed' }) });
  await service.warnReportAbusers(['U1']);
  await service.warnReportAbusers(['U1']);
  assert.ok(user.report_warned_at);
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].recipient_id, 'U1');
  assert.match(calls.notifications[0].message, /3 reports every 30 days/);
});

test('an upheld report breaks the streak; pending reports do not', async () => {
  const broken = setup({ reports: [...times(4, { status: 'dismissed' }), { status: 'reviewed' }, { status: 'dismissed' }] });
  await broken.service.warnReportAbusers(['U1']);
  assert.equal(broken.user.report_warned_at, null);

  const tooFew = setup({ reports: times(4, { status: 'dismissed' }) });
  await tooFew.service.warnReportAbusers(['U1']);
  assert.equal(tooFew.user.report_warned_at, null);

  const pending = setup({ reports: [{ status: 'pending' }, ...times(5, { status: 'dismissed' })] });
  await pending.service.warnReportAbusers(['U1']);
  assert.ok(pending.user.report_warned_at);
});
