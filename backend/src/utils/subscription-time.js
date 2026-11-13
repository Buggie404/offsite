// Ritual Box time base, shared by the charge job and every place that schedules a cycle.
// Production: 1 unit = 1 hour, so a cycle "day" is a real day (24h).
// Demo mode SUB_TIME_UNIT=minute: 1 unit = 1 minute, so a cycle "day" is 24 minutes and a
// 14-day box charges again after 14 × 24 min — the whole cycle can be watched live, in step
// with the job interval, retries (24/48/72 units), out-of-stock window and upcoming notice.
// Only the delivery cycle (frequency_days) scales; calendar rules (48h lock window, pause
// lengths, 3-day suggestion / proposal TTLs) stay in real time.
const TIME_UNIT_MS = process.env.SUB_TIME_UNIT === 'minute' ? 60 * 1000 : 60 * 60 * 1000;
const CYCLE_DAY_MS = 24 * TIME_UNIT_MS;

// Stock for a cycle is held this many units (3 days) before next_charge_at, when
// SUBSCRIPTION_UPCOMING goes out; the out-of-stock wait after next_charge_at is as long.
const RESERVE_AHEAD_UNITS = 72;

// Suspended boxes: one SUBSCRIPTION_SUSPENDED reminder after 7 days, cancelled automatically
// (cancelled_by_admin, 'Repeated payment failure') after SUSPENDED_AUTO_CANCEL_DAYS (default 30).
// Cycle days, so in demo mode they are 24-minute "days" like the delivery cycle.
const SUSPENDED_REMINDER_DAYS = 7;
const SUSPENDED_AUTO_CANCEL_DAYS = (() => {
  const value = Number(process.env.SUSPENDED_AUTO_CANCEL_DAYS);
  return Number.isFinite(value) && value > 0 ? value : 30;
})();

const addUnits = (date, units) => new Date(new Date(date).getTime() + units * TIME_UNIT_MS);
const addCycleDays = (date, days) => new Date(new Date(date).getTime() + days * CYCLE_DAY_MS);

// When a suspended box is cancelled automatically, and how many cycle days are left until then.
const autoCancelAt = (suspendedAt) => (suspendedAt ? addCycleDays(suspendedAt, SUSPENDED_AUTO_CANCEL_DAYS) : null);
const autoCancelDaysLeft = (suspendedAt, now = new Date()) => {
  const at = autoCancelAt(suspendedAt);
  return at ? Math.max(0, Math.ceil((at.getTime() - new Date(now).getTime()) / CYCLE_DAY_MS)) : null;
};

module.exports = {
  TIME_UNIT_MS, CYCLE_DAY_MS, RESERVE_AHEAD_UNITS, SUSPENDED_REMINDER_DAYS, SUSPENDED_AUTO_CANCEL_DAYS,
  addUnits, addCycleDays, autoCancelAt, autoCancelDaysLeft
};
