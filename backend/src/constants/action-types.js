// Single list of every action_type written to ActivityLogs, with its display name and filter group.
// The frontend gets it from GET /api/admin/activity-logs (facets), so add new actions here only.
// user.suspend, community_user_suspend and community.lock are no longer written (admins cannot lock
// customers); they stay listed so older logs keep their name and can still be filtered.
const ACTION_TYPES = [
  { value: 'ritual-dna.draft', label: 'Ritual DNA draft created', group: 'Ritual DNA' },
  { value: 'ritual-dna.save-draft', label: 'Ritual DNA draft saved', group: 'Ritual DNA' },
  { value: 'ritual-dna.test', label: 'Ritual DNA testing started', group: 'Ritual DNA' },
  { value: 'ritual-dna.edit', label: 'Ritual DNA draft reopened', group: 'Ritual DNA' },
  { value: 'ritual-dna.publish', label: 'Ritual DNA version published', group: 'Ritual DNA' },
  { value: 'ritual-dna.archive', label: 'Ritual DNA draft archived', group: 'Ritual DNA' },
  { value: 'ritual-dna.delete-draft', label: 'Ritual DNA draft deleted', group: 'Ritual DNA' },
  { value: 'ritual-dna.quiz-draft', label: 'Ritual DNA quiz draft created', group: 'Ritual DNA' },
  { value: 'ritual-dna.quiz-save-draft', label: 'Ritual DNA quiz draft saved', group: 'Ritual DNA' },
  { value: 'ritual-dna.quiz-test', label: 'Ritual DNA quiz testing started', group: 'Ritual DNA' },
  { value: 'ritual-dna.quiz-edit', label: 'Ritual DNA quiz draft reopened', group: 'Ritual DNA' },
  { value: 'ritual-dna.quiz-publish', label: 'Ritual DNA quiz published', group: 'Ritual DNA' },
  { value: 'ritual-dna.quiz-delete-draft', label: 'Ritual DNA quiz draft deleted', group: 'Ritual DNA' },
  { value: 'order.update-status', label: 'Order status changed', group: 'Orders' },
  { value: 'order.add-internal-note', label: 'Internal note added', group: 'Orders' },
  { value: 'order.mark-out-of-stock', label: 'Marked out of stock', group: 'Orders' },
  { value: 'order.resolve-out-of-stock', label: 'Out-of-stock line swapped or removed', group: 'Orders' },
  { value: 'refund.approve', label: 'Refund approved', group: 'Orders' },
  { value: 'refund.reject', label: 'Refund rejected', group: 'Orders' },
  { value: 'product.batch-expiry', label: 'Batch expiry updated', group: 'Products' },
  { value: 'subscription.pause', label: 'Ritual Box paused', group: 'Ritual Box' },
  { value: 'subscription.skip', label: 'Ritual Box cycle skipped', group: 'Ritual Box' },
  { value: 'subscription.unpause', label: 'Ritual Box resumed', group: 'Ritual Box' },
  { value: 'subscription.propose', label: 'Change proposed', group: 'Ritual Box' },
  { value: 'subscription.withdraw_proposal', label: 'Proposal withdrawn', group: 'Ritual Box' },
  { value: 'subscription.cancel', label: 'Ritual Box cancelled', group: 'Ritual Box' },
  { value: 'subscription.note', label: 'Ritual Box note added', group: 'Ritual Box' },
  { value: 'community_post_hide', label: 'Post hidden', group: 'Community' },
  { value: 'community_post_unhide', label: 'Post restored', group: 'Community' },
  { value: 'community_comment_hide', label: 'Comment hidden', group: 'Community' },
  { value: 'community_comment_unhide', label: 'Comment restored', group: 'Community' },
  { value: 'community_reports_dismiss', label: 'Reports dismissed', group: 'Community' },
  { value: 'community_user_warn', label: 'User warned', group: 'Community' },
  { value: 'community_user_suspend', label: 'Account suspended', group: 'Community' },
  { value: 'community.hide', label: 'Reported content hidden', group: 'Community' },
  { value: 'community.restore', label: 'Reported content restored', group: 'Community' },
  { value: 'community.warn', label: 'User warned (report)', group: 'Community' },
  { value: 'community.suspend_3d', label: 'Restricted in Community (3 days)', group: 'Community' },
  { value: 'community.suspend_7d', label: 'Restricted in Community (7 days)', group: 'Community' },
  { value: 'community.lift', label: 'Community restriction lifted', group: 'Community' },
  { value: 'community.lock', label: 'Account locked (report)', group: 'Community' },
  { value: 'community.unlock', label: 'Account unlocked (report)', group: 'Community' },
  { value: 'community.dismiss', label: 'Reports dismissed (report)', group: 'Community' },
  { value: 'user.suspend', label: 'Customer locked', group: 'Customers' },
  { value: 'user.unsuspend', label: 'Customer unlocked', group: 'Customers' },
  { value: 'customer.add_note', label: 'Customer note added', group: 'Customers' },
  { value: 'contact.update', label: 'Contact message updated', group: 'Customers' },
  { value: 'voucher.create', label: 'Create Vouchers', group: 'Vouchers' },
  { value: 'voucher.update', label: 'Update Vouchers', group: 'Vouchers' },
  { value: 'voucher.stop', label: 'Stop Voucher', group: 'Vouchers' },
  { value: 'staff.create', label: 'Staff created', group: 'Staff' },
  { value: 'staff.change_role', label: 'Role changed', group: 'Staff' },
  { value: 'staff.disable', label: 'Staff disabled', group: 'Staff' },
  { value: 'staff.enable', label: 'Staff enabled', group: 'Staff' },
  { value: 'staff.reset_password', label: 'Password reset', group: 'Staff' }
];

const LABELS = new Map(ACTION_TYPES.map(({ value, label }) => [value, label]));

const isKnownActionType = (type) => LABELS.has(type);

// Types removed from the list can still exist on old logs: show a cleaned-up raw value for those.
function actionLabel(type) {
  if (LABELS.has(type)) return LABELS.get(type);
  const words = String(type || '').replace(/[._-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

module.exports = { ACTION_TYPES, isKnownActionType, actionLabel };
