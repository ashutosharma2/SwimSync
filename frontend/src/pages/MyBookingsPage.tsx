import type { CancelReason, MyBooking, Notice } from "../api";
import { SwimPass } from "../components/SwimPass";
import { dayLabel, hhmm } from "../time";

// Why a booking was cancelled, in the swimmer's words. A cancellation by the pool always says why.
const REASON: Record<CancelReason, string> = {
  swimmer: "You cancelled this booking.",
  capacity_reduced: "Cancelled by the pool: capacity was reduced.",
  session_closed: "Cancelled by the pool: the session was closed.",
};

/** The top of the panel on this tab: the day, and whose bookings these are. */
export function BookingsHead({ mine, swimmer }: { mine: MyBooking[] | null; swimmer: string }) {
  return (
    <div className="dayrow">
      <h2 className="t day">{mine?.length ? dayLabel(mine[0].starts_at) : "Your bookings"}</h2>
      <span className="asof">Bookings for {swimmer}</span>
    </div>
  );
}

export function MyBookingsPage({ mine, notices, swimmer, openPass, onChanged, onSeeSessions }: {
  mine: MyBooking[] | null;
  notices: Notice[];
  swimmer: string;
  openPass: number | null;
  onChanged: () => void;
  onSeeSessions: () => void;
}) {
  if (mine === null) return <p className="empty">Loading your bookings…</p>;
  const live = mine.filter((b) => b.status === "confirmed");
  const gone = mine.filter((b) => b.status === "cancelled");

  return (
    <>
      <h3 className="section-title">Swim passes</h3>
      {live.length ? (
        <div className="list">
          {live.map((b) => (
            <SwimPass key={b.booking_id} booking={b} swimmer={swimmer} open={openPass === b.booking_id} onChanged={onChanged} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>You have no bookings yet.</p>
          <div className="btn-row center">
            <button className="btn" onClick={onSeeSessions}>See sessions</button>
          </div>
        </div>
      )}

      {gone.length ? (
        <>
          <h3 className="section-title">Cancelled</h3>
          <div className="list">
            {gone.map((b) => (
              <div key={b.booking_id} className="gone">
                <b><span className="t">{hhmm(b.starts_at)}</span> {b.session_name}</b>
                {REASON[b.cancel_reason ?? "swimmer"]}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h3 className="section-title">Notices</h3>
      {notices.length ? (
        <ul className="inbox">
          {[...notices].reverse().map((n) => (
            <li key={n.id}>
              <span className="t">{hhmm(n.created_at)}</span>
              <span>{n.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub">No notices yet. Confirmations and pool changes show up here.</p>
      )}
    </>
  );
}
