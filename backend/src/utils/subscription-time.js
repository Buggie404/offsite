// Ritual Box time base, shared by the charge job and every place that schedules a cycle.
// Production: 1 unit = 1 hour, so a cycle "day" is a real day (24h).
// Demo mode SUB_TIME_UNIT=minute: 1 unit = 1 minute, so a cycle "day" is 24 minutes and a
// 14-day box charges again after 14 × 24 min — the whole cycle can be watched live, in step
// with the job interval, retries (24/48/72 units), out-of-stock window and upcoming notice.
// Only the delivery cycle (frequency_days) scales; calendar rules (48h lock window, pause
// lengths, 3-day suggestion / proposal TTLs) stay in real time.
const TIME_UNIT_MS = process.env.SUB_TIME_UNIT === 'minute' ? 60 * 1000 : 60 * 60 * 1000;
const CYCLE_DAY_MS = 24 * TIME_UNIT_MS;

const addUnits = (date, units) => new Date(new Date(date).getTime() + units * TIME_UNIT_MS);
const addCycleDays = (date, days) => new Date(new Date(date).getTime() + days * CYCLE_DAY_MS);

module.exports = { TIME_UNIT_MS, CYCLE_DAY_MS, addUnits, addCycleDays };
