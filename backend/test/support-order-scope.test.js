const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative), module = { exports: {} }, real = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`, { filename })(name => Object.hasOwn(mocks,name) ? mocks[name] : real(name),module,module.exports);
  return module.exports;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; } });
test('CSKH order reads use DB assignments and own canonical/legacy chats instead of stale JWT claims', async () => {
  let query, chatQuery;
  const { supportOrderCustomerIds } = load('../src/services/support-order-scope.service.js', {
    '../models/User': { findOne: filter => { query=filter; return { lean: async () => ({ _id:'64b7f0c2a1b2c3d4e5f60718',user_id:'STAFF1',assigned_chat_customer_ids:['USR1'] }) }; } },
    '../models/ChatConversation': { distinct: async (_, filter) => { chatQuery=filter; return ['USR2','USR1']; } }
  });
  assert.deepEqual(await supportOrderCustomerIds({role:'cskh',user_id:'64b7f0c2a1b2c3d4e5f60718',assigned_chat_customer_ids:['STALE']}), ['USR1','USR2']);
  assert.deepEqual(query,{_id:'64b7f0c2a1b2c3d4e5f60718'});
  assert.deepEqual(chatQuery.agent_id.$in,['64b7f0c2a1b2c3d4e5f60718','STAFF1']);
  assert.deepEqual(chatQuery.status.$in,['open','closed']);
  await supportOrderCustomerIds({role:'cskh',user_id:'STAFF1'}); assert.deepEqual(query,{user_id:'STAFF1'});
  assert.equal(await supportOrderCustomerIds({role:'qlsp'}),null);
});
test('missing staff account has no order access', async () => {
  const { supportOrderCustomerIds } = load('../src/services/support-order-scope.service.js', {
    '../models/User': { findOne: () => ({ lean: async () => null }) },
    '../models/ChatConversation': { distinct: async () => assert.fail('missing staff must not query chats') }
  });
  assert.deepEqual(await supportOrderCustomerIds({role:'cskh',user_id:'STAFF1'}),[]);
});
test('order detail allows supported customers and rejects unrelated customers', async () => {
  let owner='USR1';
  const api=load('../src/controllers/admin.controller.js', {
    '../models/Order': { findOne: () => ({lean: async () => ({order_id:'OFS-2026-00117',user_id:owner,items:[],pricing:{},delivery_info:{},internal_notes:[]})}) },
    '../models/RefundRequest': { findOne: () => ({sort: () => ({lean: async () => null})}) },
    '../services/subscription.service': {getOrderRitualBoxes: async () => []},
    '../services/support-order-scope.service': {supportOrderCustomerIds: async () => ['USR1']}
  });
  const req={user:{role:'cskh',user_id:'STAFF1'},params:{id:'OFS-2026-00117'}};
  let res=response(); await api.getOrderById(req,res); assert.equal(res.statusCode,200); assert.equal(res.body.data.order_id,'OFS-2026-00117');
  owner='OTHER'; res=response(); await api.getOrderById(req,res); assert.equal(res.statusCode,403);
});
test('CSKH can pass order read middleware but cannot pass any order write middleware', () => {
  const auth=require('../src/middleware/auth.middleware');
  const req={user:{role:'cskh'}};
  let reads=0,writes=0; const read=response(),write=response();
  auth.requireRole(...auth.ADMIN_ORDER_VIEW_ROLES)(req,read,()=>reads++);
  auth.requireRole(...auth.ADMIN_ORDER_MANAGE_ROLES)(req,write,()=>writes++);
  assert.equal(reads,1); assert.equal(writes,0); assert.equal(write.statusCode,403);
});
