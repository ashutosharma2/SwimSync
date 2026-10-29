import type { MyBooking, Session } from "../api";
import { RopeLegend } from "../components/FloatRope";
import { SessionCard } from "../components/SessionCard";
import { clock, dayLabel } from "../time";

/** The top of the panel: the day, how fresh the numbers are, and what the floats mean. */
export function SessionsHead({ sessions, asOf, stale }: { sessions: Session[] | null; asOf: Date | null; stale: boolean }) {
  const label = asOf ? (stale ? `Couldn't refresh. Places as of ${clock(asOf)}` : `Places as of ${clock(asOf)}`) : stale ? "Can't reach the booking server." : "Loading places…";
  return (
    <>
      <div className="dayrow">
        <h2 className="t day">{sessions?.length ? dayLabel(sessions[0].starts_at) : "Sessions"}</h2>
        <span className={`asof${stale ? " stale" : ""}`}>{label}</span>
      </div>
      <RopeLegend />
      <p className="hint">Each float is one place. The numbers can be a few seconds old; only a confirmation reserves a place.</p>
    </>
  );
}

export function SessionsPage({ sessions, mine, swimmer, onChanged, onShowPass }: {
  sessions: Session[] | null;
  mine: MyBooking[] | null;
  swimmer: string;
  onChanged: () => void;
  onShowPass: (bookingId: number | null) => void;
}) {
  if (sessions === null) return <p className="empty">Loading sessions…</p>;
  if (sessions.length === 0) return <p className="empty">No sessions are open for booking yet.</p>;
  return (
    <div className="list">
      {sessions.map((s) => {
        const confirmed = mine?.find((b) => b.session_id === s.id && b.status === "confirmed");
        // The pool cancelled this swimmer's booking here (capacity cut or closure): the card says so.
        const poolCut = !confirmed && !!mine?.some((b) => b.session_id === s.id && b.status === "cancelled" && b.cancel_reason && b.cancel_reason !== "swimmer");
        return (
          <SessionCard
            key={`${swimmer}-${s.id}`}
            session={s}
            swimmer={swimmer}
            mine={confirmed}
            poolCut={poolCut}
            onChanged={onChanged}
            onShowPass={onShowPass}
          />
        );
      })}
    </div>
  );
}
