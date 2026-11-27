// A referral has two independent milestones. Advancing the order must not
// replace the signup reward or combine posted and pending amounts in one row.
function referralActivityRows(referrals) {
  return referrals.flatMap(row => {
    const friend = row.referee_display || 'Friend';
    const registered = row.register_reward_status === 'posted';
    const activity = [{
      id: `${row.referral_id}:signup`, friend,
      status: registered ? 'Signed up · points posted' : 'Signed up · ineligible',
      points: registered ? (row.register_points ?? 20) : 0
    }];
    const orderStatus = row.order_reward_status;
    if (row.first_order_id || ['awaiting_post', 'posted'].includes(orderStatus)) {
      const posted = orderStatus === 'posted';
      const ineligible = orderStatus === 'ineligible';
      activity.push({
        id: `${row.referral_id}:first-order`, friend,
        status: posted ? 'First order · points posted'
          : ineligible ? 'First order · ineligible' : 'First order · points pending',
        points: ineligible ? 0 : (row.order_points ?? 20)
      });
    }
    return activity;
  });
}
module.exports = { referralActivityRows };
