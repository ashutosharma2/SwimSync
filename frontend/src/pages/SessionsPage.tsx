import { useEffect, useState } from "react";

import { api, type Session } from "../api";
import { SessionCard } from "../components/SessionCard";
import { formatClock } from "../time";

const REFRESH_MS = 5000;

export function SessionsPage({ swimmer, changes, onChanged, onShowBookings }: {
  swimmer: string;
  changes: number;
  onChanged: () => void;
  onShowBookings: () => void;
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function load() {
      const answer = await api.sessions();
      if (stopped) return;
      if (answer.status === 200) {
        setSessions(answer.body);
        setAsOf(new Date());
        setUnreachable(false);
      } else {
        setUnreachable(true); // keep showing the last numbers, marked as old
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [changes]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Tomorrow's sessions</h2>
        {asOf ? (
          <p className={`text-xs ${unreachable ? "text-amber-800" : "text-slate-500"}`}>
            Places left as of {formatClock(asOf)}
            {unreachable ? " · can't reach the server, showing the last numbers" : " · updates every 5 s"}
          </p>
        ) : null}
      </div>

      {sessions === null ? (
        <p className="text-sm text-slate-500">{unreachable ? "Can't reach the booking server right now." : "Loading sessions…"}</p>
      ) : (
        <div className="grid gap-3">
          {sessions.map((s) => (
            <SessionCard key={`${swimmer}-${s.id}`} session={s} swimmer={swimmer} onChanged={onChanged} onShowBookings={onShowBookings} />
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        The number of places is a guide that can be a few seconds old. Only a confirmation from the server reserves a place.
      </p>
    </section>
  );
}
