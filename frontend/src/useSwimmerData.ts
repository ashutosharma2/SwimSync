import { useEffect, useState } from "react";

import { api, type MyBooking, type Notice, type Session } from "./api";

const REFRESH_MS = 5000;

/**
 * The sessions list, the swimmer's bookings and their notices, read together every 5 s and again
 * whenever `changes` goes up. If a read fails, the last numbers stay on screen, marked as stale.
 */
export function useSwimmerData(swimmer: string, changes: number) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [mine, setMine] = useState<MyBooking[] | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [shownFor, setShownFor] = useState(swimmer);

  // A different swimmer: drop the previous swimmer's bookings straight away rather than show them.
  if (shownFor !== swimmer) {
    setShownFor(swimmer);
    setMine(null);
    setNotices([]);
  }

  useEffect(() => {
    let stopped = false;
    async function load() {
      const [s, m, n] = await Promise.all([api.sessions(), api.myBookings(swimmer), api.notifications(swimmer)]);
      if (stopped) return;
      if (s.status === 200) {
        setSessions(s.body);
        setAsOf(new Date());
        setStale(false);
      } else {
        setStale(true); // keep showing the last numbers, marked as old
      }
      if (m.status === 200) setMine(m.body);
      if (n.status === 200) setNotices(n.body);
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [swimmer, changes]);

  return { sessions, mine, notices, asOf, stale };
}
