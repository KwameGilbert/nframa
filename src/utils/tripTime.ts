// Service time is Ghana: UTC+0, no daylight saving. Every trip date and time goes through here and uses only
// UTC getters, so the server's TZ never matters.

// YYYY-MM-DD in service time.
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ISO weekday of a YYYY-MM-DD date: 1 = Monday .. 7 = Sunday (commutes' recurrenceDays).
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`);
  // Date rolls 2026-02-30 over to March, so a date must read back as itself.
  if (Number.isNaN(day.getTime()) || today(day) !== date) throw new Error(`Invalid date: ${date}`);
  return day.getUTCDay() || 7;
}

// When a commute leaves on a date; time is the commute's departureTime (HH:MM:SS, or HH:MM).
export function departureAt(date: string, time: string): Date {
  return new Date(`${date}T${time}Z`);
}
