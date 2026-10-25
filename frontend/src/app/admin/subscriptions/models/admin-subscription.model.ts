export type AdminSubscriptionStatus =
  | 'active'
  | 'paused'
  | 'payment_failed'
  | 'suspended'
  | 'cancelled'
  | 'cancelled_by_admin';

export type AdminSubscriptionFilter = 'all' | 'active' | 'needs_action' | 'paused' | 'cancelled';

/** Staff can't charge a card or change the schedule directly — only propose it. */
export type AdminSubscriptionAction =
  | 'pause'
  | 'skip'
  | 'unpause'
  | 'propose'
  | 'withdraw_proposal'
  | 'cancel'
  | 'note';

export type AdminProposalType = 'frequency' | 'resume';

export type AdminPauseOption = '1_month' | '2_months' | 'until_reactivated';

/** Pause from the upcoming delivery, or let it ship and pause from the one after. */
export type AdminPauseAffects = 'next' | 'following';

/** Cancel now, or after one more charge + delivery. */
export type AdminCancelEffective = 'now' | 'after_next';

export interface AdminSubscriptionCustomer {
  user_id: string;
  name: string;
  initials: string;
  email: string | null;
}

export interface AdminSubscriptionRow {
  subscription_id: string;
  customer: AdminSubscriptionCustomer;
  product_name: string;
  variant_label: string;
  box: string;
  image: string | null;
  quantity: number;
  frequency_days: number;
  next_charge_at: string | null;
  status: AdminSubscriptionStatus;
  out_of_stock: boolean;
  price: number;
  created_at: string;
}

export interface AdminSubscriptionStats {
  active: number;
  affected_by_stock: number;
  paused: number;
  needs_action: number;
}

export interface AdminSubscriptionsResponse {
  data: AdminSubscriptionRow[];
  stats: AdminSubscriptionStats;
}

export interface AdminSubscriptionReplacement {
  product_id: string;
  variant_id: string;
  name: string;
  variant_label: string;
  image: string | null;
  price: number;
  same_price?: boolean;
  offered?: boolean;
}

export interface AdminSubscriptionDelivery {
  date: string;
  order_id: string;
  result: 'processing' | 'shipping' | 'delivered' | 'cancelled' | 'refund' | 'failed';
}

export interface AdminSubscriptionMessage {
  action:
    | 'pause' | 'cancel' | 'resume' | 'reactivate' | 'frequency' | 'skip' | 'unpause'
    | 'propose' | 'withdraw_proposal' | 'proposal_accepted' | 'proposal_declined' | 'proposal_expired';
  reason: string | null;
  message: string;
  ticket_id?: string | null;
  sent_by: string;
  sent_at: string;
}

export interface AdminSubscriptionDetail extends AdminSubscriptionRow {
  pricing: { original_price: number; subscribe_price: number; discount_percent: number };
  card: { brand: string; last4: string } | null;
  pause_option: AdminPauseOption | null;
  resume_at: string | null;
  upcoming_delivery_at: string;
  following_delivery_at: string;
  pending_changes: {
    frequency_days: number | null;
    skip: boolean;
    pause_option: AdminPauseOption | null;
    cancel: boolean;
  } | null;
  failed_attempts: number;
  last_failure_reason: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  replacement: AdminSubscriptionReplacement | null;
  deliveries: AdminSubscriptionDelivery[];
  open_order_ids: string[];
  messages: AdminSubscriptionMessage[];
  internal_note: string;
  internal_note_updated_at: string | null;
  paused_by: 'customer' | 'admin' | null;
  admin_proposal: AdminSubscriptionProposal | null;
  permissions: AdminSubscriptionPermissions;
}

export interface AdminSubscriptionProposal {
  type: AdminProposalType;
  frequency_days: number | null;
  reason: string | null;
  message: string;
  ticket_id: string | null;
  proposed_at: string;
  expires_at: string;
}

/** What the signed-in staff member may do on this box (from the server's role rules). */
export interface AdminSubscriptionPermissions {
  role: string | null;
  pause: boolean;
  skip: boolean;
  unpause: boolean;
  cancel: boolean;
  propose_frequency: boolean;
  propose_resume: boolean;
  withdraw_proposal: boolean;
  note: boolean;
  pause_reasons: string[];
  skip_reasons: string[];
  cancel_reasons: string[];
  ticket_required_for: string[];
}
