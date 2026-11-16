// Customer events added after the original order/community notification implementation.
// Keys are shared with the customer bell; existing notification types remain supported.
module.exports = {
  FOLLOW_RECEIVED: 'community',
  COMMUNITY_CONTENT_HIDDEN: 'community',
  COMMUNITY_CONTENT_RESTORED: 'community',
  SUBSCRIPTION_CHARGED: 'ritual_box',
  SUBSCRIPTION_STARTED: 'ritual_box',
  SUBSCRIPTION_UPDATED: 'ritual_box',
  SUPPORT_CLOSED: 'support',
  CONSUMPTION_REMINDER: 'pantry',
  POINTS_PENDING: 'rewards',
  POINTS_POSTED: 'rewards',
  POINTS_REVERSED: 'rewards',
  POINTS_USED: 'rewards',
  MEMBERSHIP_CHANGED: 'rewards',
  VOUCHER_RECEIVED: 'rewards',
  VOUCHER_EXPIRING: 'rewards',
  VOUCHER_EXPIRED: 'rewards',
  VOUCHER_WITHDRAWN: 'rewards',
  SUPPORT_REPLY: 'support',
  CONTACT_STATUS: 'support',
  RITUAL_DNA_CHANGED: 'ritual_dna',
  ORDER_DELIVERED: 'orders',
  ORDER_CONFIRMED: 'orders',
  ORDER_PAYMENT_FAILED: 'orders',
  ORDER_CUSTOMER_CANCELED: 'orders'
};
