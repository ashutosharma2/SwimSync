import { useEffect, useState } from "react";

import { api, operatorApi, type ChangeLogEntry, type Session, type SessionPlaces } from "../api";

const REFRESH_MS = 5000;

/**
 * The sessions list, who holds a place in the chosen session, and the change log, read together
 * every 5 s and again whenever `changes` goes up. A failed read keeps the last data on screen, marked
 * as stale. A 403 means the token stopped being accepted, so `onRefused` sends the operator back to
 * the sign-in form.
 */
export function useOperatorData(token: string, sessionId: number | null, changes: number, onRefused: () => void) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [places, setPlaces] = useState<SessionPlaces | null>(null);
  const [log, setLog] = useState<ChangeLogEntry[] | null>(null);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [shownFor, setShownFor] = useState(sessionId);

  // A different session: drop the previous session's bookings straight away rather than show them.
  if (shownFor !== sessionId) {
    setShownFor(sessionId);
    setPlaces(null);
  }

  useEffect(() => {
    let stopped = false;
    async function load() {
      const [s, p, l] = await Promise.all([
        api.sessions(),
        sessionId === null ? null : operatorApi.places(sessionId, token),
        operatorApi.changeLog(token),
      ]);
      if (stopped) return;
      if (p?.status === 403 || l.status === 403) {
        onRefused();
        return;
      }
      if (s.status === 200) setSessions(s.body);
      if (p?.status === 200) setPlaces(p.body);
      if (l.status === 200) setLog(l.body);
      const ok = s.status === 200 && (p === null || p.status === 200) && l.status === 200;
      setStale(!ok); // keep showing the last data, marked as old
      if (ok) setAsOf(new Date());
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // onRefused is left out on purpose: a new function each render would restart the polling.
  }, [token, sessionId, changes]);

  return { sessions, places, log, asOf, stale };
}
