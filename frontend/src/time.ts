export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const pad = (n: number) => String(n).padStart(2, "0");

/** A session time as a timetable shows it: 24-hour, "06:30". */
export function hhmm(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** When the numbers were fetched: "17:21:09". */
export function clock(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "Today", "Tomorrow", or the date, for the day a session is on. */
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso), start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(d) - start(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
