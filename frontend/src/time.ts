export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatClock(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
