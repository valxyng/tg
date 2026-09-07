/** Converts an ISO calendar date and minutes-from-midnight in a named IANA zone to UTC. */
export function studioDateTime(date: string, minutes: number, zone: string) {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let instant = naive;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const displayed = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    instant += naive - displayed;
  }
  return new Date(instant);
}
export function dateInZone(value: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2,"0")}:${String(minutes % 60).padStart(2,"0")}`;
