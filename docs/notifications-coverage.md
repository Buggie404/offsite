# Customer notification coverage

This inventory covers customer-visible events implemented by the website. Admin action queues remain in `admin-notifications.controller.js` and retain their role restrictions.

## Event inventory

| Area | Events | Destination |
| --- | --- | --- |
| Orders | Order placed; confirmed/preparing; shipping; delivered; customer cancellation; payment failure; payment timeout; store cancellation; delivery failure; redelivery reminder/expiry | Order tracking for the exact order |
| Refunds | Request received; approved; rejected with reason; payout sent | Order tracking |
| Community | Post created; post/comment liked; comment/reply; new follower; post/comment hidden or restored by direct staff action or automatic moderation; warning/restriction/restoration; report confirmed | Post/thread, follower profile, or Community for account/report messages |
| Recipes | Published/promoted; moderation/hide/restore/delete/review notice; recipe saved by another member | Recipe detail/editor or Recipes when the item is unavailable |
| Ritual Box | Started; charge succeeded; customer changes saved; paused/resumed/cancelled; upcoming charge; payment failure/suspension; out of stock; skipped delivery; staff proposal/withdrawal; failure to start; suggested frequency change | Account → Ritual Box; failure to start can open the source order |
| Pantry | Items added after delivery; expiry approaching; expired items | Account → Pantry |
| Purchase reminders | Estimated replenishment from at least two delivered purchases of the same consumable; once per latest purchase | Product detail |
| Rewards | Points pending; posted/available; reversed; spent; membership upgrade | Account → Rewards |
| Personal vouchers | Received/activated; expiring within three days; expired; withdrawn/inactive | Account → Rewards |
| Support | Staff reply; staff closes conversation; Contact Us request status changes | Exact chat history where linked, or Contact Us |
| Ritual DNA | Behaviour-driven archetype change after the existing margin/cooldown rules permit it | Account → My Ritual DNA |

Every persisted type has an explicit customer icon and colour. Filter tabs include Orders, Community, Recipes, Ritual Box, Pantry, Rewards, Support, and Ritual DNA. Badges count unread items in the fetched inbox (up to 200 recent notifications).

## Delivery and deduplication

- New events use `event_key` with a unique sparse database index. Notification IDs use UUIDs to avoid the previous read-latest/increment race.
- Deleting a notification hides it and preserves its deduplication key, so a background retry does not bring it back.
- Follow notifications are limited to one per follower/recipient pair per UTC day. A duplicate follow request increments no counters and creates no additional notification.
- Existing report moderation sends the staff-written message once. The lower-level hide/restore message is suppressed on that path; direct admin actions and auto-hide still notify the author.
- Pantry jobs retain their per-item sent flags and now also provide event keys.
- Reward events are reconciled from committed PointTransactions every 30 seconds, covering referral, review, community, quiz, purchase, redemption and adjustment transactions. Marker updates do not alter the transaction timestamp. Failed delivery is retried.
- A persisted activation date prevents historical points/follows/order statuses from being announced on deployment. Confirmed/delivered orders and follows also have reconciliation retries, covering transaction saves and query-based payment transitions.
- Voucher jobs use Vietnam calendar dates, including the last valid day. Only personal vouchers generate customer notices; generic campaigns do not broadcast to every account.
- Consumption reminders run once per Vietnam calendar day. They honour `notification_preferences.consumption_reminder = false`, skip products already in an active/paused/failed/suspended Ritual Box, and only consider coffee/matcha. The threshold is 85% of the average interval between delivered purchases; the message identifies this as an estimate.
- Guests have no notification inbox. Existing email/SMS simulation and chat socket delivery continue through their existing paths. The bell uses its existing polling refresh.
- Notification failures are logged and do not undo completed business actions. Inline-only failures in areas without a reconciliation job require a retry of the source action; this is not a universal transactional outbox.

## Scope boundaries

Follow, post/comment likes, comments/replies and recipe-save notifications display the sender's avatar. Missing or failed images fall back to the sender's initials. System updates retain their event icon.

Notifications concern a customer's own transactions, content, rewards and support. Unfollow, removing a like/save, page views, internal staff notes, stock edits and AI fallback do not send customer notifications. Admin stock/report/support queues cover operational work.

Features that have no implemented business action (for example a separate product-review moderation screen) are not invented by the notification layer. Existing business rules determine whether an event occurs; notification code observes its successful result.

## Verification

- Customer event schemas and explicit icon coverage.
- Concurrent ID generation, duplicate events, per-recipient deletion and retries after deletion.
- Follow idempotency and correct recipient/profile target.
- Reward states, retry markers and timestamp preservation.
- Voucher date boundaries and consumed-voucher suppression.
- Consumption preference and Ritual Box suppression, including Mongo product IDs.
- Existing moderation, points-posting, subscription-start, stock-hold, cycle-time and suggestion-withdrawal regression suites.

These automated tests use isolated model stubs; a full browser/MongoDB integration run is still required for deployment acceptance.
