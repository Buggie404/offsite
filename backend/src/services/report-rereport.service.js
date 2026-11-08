const { activeRestriction, formatDate } = require('./community-restriction.service');

// When the same person may report the same post, comment or account again:
//   their latest report on it is still pending          -> no
//   staff restored the content (or lifted the account's penalty) after that report -> yes
//   it was upheld and the author is still serving a penalty -> no, until the penalty ends
//   it was dismissed, upheld with only a warning, or the penalty is over -> yes
// The Reports index allows one pending report per reporter and target, which stops double submits.

function openReportMessage(type) {
  return `You have already reported this ${type}. We are still reviewing your report.`;
}

// Model: PostReport / CommentReport / AccountReport. filter: target field + reporter_id.
// loadOwner: returns the author (with community_restriction); only called when it matters.
// restoredAfter(date): true when staff restored the target after the report was closed.
async function rereportBlock({ Model, filter, type, loadOwner, restoredAfter }) {
  const latest = await Model.findOne(filter, 'status created_at updated_at').sort({ created_at: -1 }).lean();
  if (!latest || latest.status === 'dismissed') return null;
  if (latest.status === 'pending') return openReportMessage(type);
  // A restore is staff saying the target is fine to show again: it can be reported afresh.
  if (await restoredAfter(latest.updated_at || latest.created_at)) return null;
  const restriction = activeRestriction(await loadOwner());
  if (!restriction) return null;
  const who = type === 'account' ? 'This account is' : 'Its author is';
  return `${who} already serving a penalty until ${formatDate(restriction.until)}. You can report this ${type} again after that.`;
}

// The Reports index refused the insert. With the current index that only happens when an open report
// slipped in at the same moment; with the old index (scripts/allow-rereport.js not run yet) it also
// happens for closed reports, so look before claiming the report is still under review.
async function duplicateReportMessage({ Model, filter, type }) {
  const open = await Model.findOne({ ...filter, status: 'pending' }, '_id').lean();
  if (open) return openReportMessage(type);
  console.warn('[reports] A closed report blocked a new one: the old Reports indexes are still in place. Run: node scripts/allow-rereport.js');
  return `You have already reported this ${type}.`;
}

// Builds restoredAfter for a target from the moderation history. For accounts, "restore" is the lift
// of a suspension (or the unlock of an older lock).
function restoredAfterFrom(ModerationAction, targetType, targetId) {
  const actions = targetType === 'account' ? ['lift', 'unlock'] : ['restore'];
  return async (since) => !!(await ModerationAction.exists({
    target_type: targetType, target_id: targetId, action: { $in: actions }, created_at: { $gt: since }
  }));
}

module.exports = { rereportBlock, openReportMessage, duplicateReportMessage, restoredAfterFrom };
