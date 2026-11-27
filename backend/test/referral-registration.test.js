const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function fixture({ failTransaction = false, yearlyCount = 0, oauth = false } = {}) {
  let state = {
    users: {
      USR1: { user_id: 'USR1', points: 428 },
      USR2: { user_id: 'USR2', profile_name: 'Vivian', points: 0,
        referred_by: 'ANH_AB12CD34', referral_registration_pending: true,
        oauth_providers: oauth ? [{ provider: 'google' }] : [], createdAt: new Date() }
    }, refs: [], transactions: [], vouchers: {}
  };
  let fail = failTransaction;
  let tail = Promise.resolve();
  const query = value => ({ session() { return this; }, lean: async () => structuredClone(value) });
  const sessions = new Set();
  function inSession(options) { assert.ok(sessions.has(options?.session), 'all reward writes must share the transaction'); }
  const User = {
    db: { startSession: async () => {
      const session = {
        withTransaction: async fn => {
          const before = tail;
          let release;
          tail = new Promise(resolve => { release = resolve; });
          await before;
          const snapshot = structuredClone(state);
          try { await fn(); } catch (e) { state = snapshot; throw e; } finally { release(); }
        }, endSession: async () => {}
      };
      sessions.add(session);
      return session;
    }},
    findOne: f => query(state.users[f.user_id]),
    updateOne: async (f, u, opts) => {
      inSession(opts);
      const user = state.users[f.user_id];
      if (u.$set) Object.assign(user, u.$set);
      if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) user[k] = (user[k] || 0) + v;
      return { modifiedCount: 1 };
    }
  };
  const mocks = {
    '../models/User': User,
    '../models/Referral': {
      findOne: f => query(state.refs.find(r => r.referee_id === f.referee_id)),
      countDocuments: () => ({ session: async () => yearlyCount + state.refs.length }),
      create: async ([row], options) => { inSession(options); state.refs.push(row); return [row]; }
    },
    '../models/PointTransaction': { create: async ([row], options) => {
      inSession(options);
      if (fail) { fail = false; throw new Error('temporary point write failure'); }
      state.transactions.push(row); return [row];
    }},
    '../models/Voucher': { findOneAndUpdate: async (f, u, options) => {
      inSession(options);
      state.vouchers[f.code] ||= { ...u.$setOnInsert };
      return state.vouchers[f.code];
    }}
  };
  const file = path.resolve(__dirname, '../src/services/referral-registration.service.js');
  const mod = { exports: {} };
  const realRequire = createRequire(file);
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports);
  return { service: mod.exports, state: () => state };
}
const register = f => f.service.completeRegistration('USR2', 'USR1', 'ANH_AB12CD34');

test('signup credits referrer 20 and issues referee a personal $5 voucher immediately', async () => {
  const f = fixture();
  await register(f);
  const s = f.state();
  assert.equal(s.users.USR1.points, 448);
  assert.equal(s.users.USR2.points, 0);
  assert.equal(s.users.USR2.referral_registration_pending, false);
  assert.equal(s.refs[0].order_reward_status, 'pending');
  assert.equal(s.transactions[0].amount, 20);
  assert.equal(s.transactions[0].status, 'posted');
  const voucher = s.vouchers[s.users.USR2.welcome_voucher_code];
  assert.equal(voucher.discount_value, 5);
  assert.equal(voucher.assigned_user_id, 'USR2');
  assert.equal(voucher.usage_limit, 1);
});

test('sequential and concurrent retries cannot duplicate points, Referral or voucher', async () => {
  const f = fixture();
  await Promise.all([register(f), register(f), register(f)]);
  await register(f);
  assert.equal(f.state().users.USR1.points, 448);
  assert.equal(f.state().refs.length, 1);
  assert.equal(f.state().transactions.length, 1);
  assert.equal(Object.keys(f.state().vouchers).length, 1);
});

test('failed point write rolls back all benefits and leaves signup eligible for retry', async () => {
  const f = fixture({ failTransaction: true });
  await assert.rejects(register(f), /temporary point write failure/);
  assert.equal(f.state().users.USR1.points, 428);
  assert.equal(f.state().users.USR2.referral_registration_pending, true);
  assert.equal(f.state().refs.length, 0);
  assert.equal(Object.keys(f.state().vouchers).length, 0);
  await register(f);
  assert.equal(f.state().users.USR1.points, 448);
  assert.equal(f.state().transactions.length, 1);
});

test('yearly limit records an ineligible Referral without crediting points', async () => {
  const f = fixture({ yearlyCount: 10 });
  await register(f);
  assert.equal(f.state().users.USR1.points, 428);
  assert.equal(f.state().refs[0].ineligible_reason, 'yearly_limit');
  assert.equal(f.state().transactions.length, 0);
});

test('OAuth accounts, self-referrals and codes not saved at signup cannot earn signup rewards', async () => {
  const oauth = fixture({ oauth: true });
  assert.equal(await register(oauth), null);
  const f = fixture();
  assert.equal(await f.service.completeRegistration('USR2', 'USR2', 'ANH_AB12CD34'), null);
  assert.equal(await f.service.completeRegistration('USR2', 'USR1', 'OTHER_AB12CD34'), null);
  assert.equal(f.state().transactions.length, 0);
});

test('rechecking a used welcome voucher does not reset its usage or extend its expiry', async () => {
  const f = fixture();
  await register(f);
  const code = f.state().users.USR2.welcome_voucher_code;
  const voucher = f.state().vouchers[code];
  voucher.used_count = 1;
  const expires = voucher.valid_to;
  await register(f);
  assert.equal(f.state().vouchers[code].used_count, 1);
  assert.equal(f.state().vouchers[code].valid_to, expires);
});

test('OTP verification persists referral intent before reward failure and OTP deletion', async t => {
  const file = path.resolve(__dirname, '../src/controllers/auth.controller.js');
  const realRequire = createRequire(file);
  const mod = { exports: {} };
  let inserted, deleted = false;
  const pending = {
    _id: 'OTP1', registration_id: 'REG1', otp: '123456',
    expiresAt: new Date(Date.now() + 60000), profile_name: 'Vivian',
    password_hash: 'test-hash', email: 'vivian@example.com', referral_code: 'ANH_AB12CD34'
  };
  const userCollection = {
    findOne: async () => null,
    insertOne: async user => { inserted = structuredClone(user); return { insertedId: 'mongo-user' }; }
  };
  const mocks = {
    bcrypt: {},
    jsonwebtoken: { sign: () => 'test-token' },
    '../config/db': { getCollections: async () => ({
      userCollection, otpCollection: {
        findOne: async () => pending,
        deleteOne: async () => {
          assert.equal(inserted.referred_by, pending.referral_code);
          assert.equal(inserted.referral_registration_pending, true);
          deleted = true;
        }
      }
    }) },
    '../services/cart-merge.service': {},
    '../services/user-id.service': { nextUserId: async () => 'USR2' },
    '../config/auth': { JWT_SECRET: 'test', AUTH_TOKEN_TTL: '1h' },
    '../services/loyalty.service': { handleReferralRegistration: async () => { throw new Error('temporary outage'); } },
    '../services/guest-order-link.service': { linkGuestOrders: async () => [] }
  };
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports);
  t.mock.method(console, 'error', () => {});
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; } };
  await mod.exports.verifyRegistrationOtp({ body: { registration_id: 'REG1', otp: '123456' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(deleted, true);
  assert.equal(inserted.referral_registration_pending, true);
});

test('actual signup submit method includes a pasted referral and clears a stale model when the input is empty', async () => {
  const ts = require('../../frontend/node_modules/typescript');
  const filename = path.resolve(__dirname, '../../frontend/src/app/shared/components/auth-modal/auth-modal.component.ts');
  const text = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const component = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AuthModalComponent');
  const method = component.members.find(node => node.name?.getText(ast) === 'onSubmitAuth');
  const js = ts.transpileModule('class SignupHandler {' + method.getText(ast) + '} module.exports = SignupHandler;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, setTimeout: () => 0 });
  for (const [visible, model, expected] of [
    ['  anh_ab12cd34  ', '', 'ANH_AB12CD34'],
    ['', 'OLD_AB12CD34', undefined]
  ]) {
    let payload;
    const handler = new mod.exports();
    Object.assign(handler, {
      mode: () => 'signup', signupName: 'Vivian', signupEmail: 'vivian@example.com',
      signupPhone: '', signupPassword: 'Password1!', signupConfirmPassword: 'Password1!',
      signupReferralCode: model, signupReferralInput: { nativeElement: { value: visible } },
      signupValidator: { validateAll: () => true },
      authService: { register: async data => { payload = data; return { registration_id: 'REG1' }; } },
      cdr: { detectChanges() {} }, startOtpCountdown() {}, focusHiddenInput() {}
    });
    await handler.onSubmitAuth({ preventDefault() {} });
    assert.equal(payload.referral_code, expected);
    assert.equal(handler.isOtpStep, true);
  }
});
