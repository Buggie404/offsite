// Dry run: node scripts/migrate-community-reports.js
// Apply during a maintenance window: node scripts/migrate-community-reports.js --apply
// Legacy collections stay intact. Existing Reports rows are backed up before normalization.
require('dotenv').config();
const mongoose = require('mongoose');
const Report = require('../src/models/Report');

function normalizeReport(row, source, userIds) {
  const legacyType = row.target_type === 'profile' ? 'account' : row.target_type;
  const target_type = legacyType || (row.comment_id ? 'comment' : row.reported_user_id ? 'account' : row.post_id ? 'post' : null);
  const field = { post: 'post_id', comment: 'comment_id', account: 'reported_user_id' }[target_type];
  if (!field || !row[field] || !row.reporter_id || !Report.REPORT_REASONS.includes(row.reason)) {
    throw new Error(`Unsupported report ${source}/${row._id}; migration stopped without dropping source data.`);
  }
  return {
    target_type, [field]: String(row[field]),
    ...(target_type === 'comment' ? { post_id: row.post_id } : {}),
    reporter_id: userIds.get(String(row.reporter_id)) || String(row.reporter_id),
    reason: row.reason, note: String(row.note || '').slice(0, 500),
    status: ['pending', 'reviewed', 'dismissed'].includes(row.status) ? row.status : 'pending',
    created_at: row.created_at || row.createdAt || row._id.getTimestamp(),
    updated_at: row.updated_at || row.updatedAt || row.created_at || row._id.getTimestamp()
  };
}

async function main() {
  // Disable automatic index creation until duplicates have been merged.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name));
  const sources = ['Reports', 'Report', 'reports', 'PostReports', 'CommentReports', 'AccountReports'].filter(name => names.has(name));
  const users = await db.collection('Users').find({}, { projection: { _id: 1, user_id: 1 } }).toArray();
  const userIds = new Map(users.map(user => [String(user._id), user.user_id]));
  const groups = new Map();
  let count = 0;
  // Validate every source before making any changes.
  for (const source of sources) {
    for await (const row of db.collection(source).find({})) {
      const data = normalizeReport(row, source, userIds);
      const field = { post: 'post_id', comment: 'comment_id', account: 'reported_user_id' }[data.target_type];
      const key = JSON.stringify([data.target_type, data[field], data.reporter_id]);
      const group = groups.get(key) || { data, field, existingIds: [] };
      if (source === 'Reports') group.existingIds.push(row._id);
      // Keep a reviewed decision when merging duplicate reports.
      if (data.status !== 'pending') group.data.status = data.status;
      if (data.created_at < group.data.created_at) group.data.created_at = data.created_at;
      groups.set(key, group);
      count++;
    }
  }
  console.log(JSON.stringify({ sources, source_rows: count, merged_reports: groups.size, apply: process.argv.includes('--apply') }));
  if (!process.argv.includes('--apply')) return;
  const target = db.collection('Reports');
  if (names.has('Reports')) {
    for await (const row of target.find({})) {
      await db.collection('ReportsMigrationBackup').updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
    }
  }
  for (const { data, field, existingIds } of groups.values()) {
    const filter = existingIds.length ? { _id: existingIds[0] } : { target_type: data.target_type, [field]: data[field], reporter_id: data.reporter_id };
    if (existingIds.length > 1) await target.deleteMany({ _id: { $in: existingIds.slice(1) } });
    await target.updateOne(filter, { $set: data }, { upsert: true });
  }
  await Report.createIndexes();
  console.log('Reports migration complete. Legacy collections and ReportsMigrationBackup were retained.');
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { normalizeReport };
