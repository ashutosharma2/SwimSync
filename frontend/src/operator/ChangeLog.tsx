import type { ChangeLogEntry } from "../api";
import { hhmm } from "../time";

/** One change in words. The API gives the cancelled booking ids, not who held them. */
function describe(e: ChangeLogEntry) {
  const ids = e.affected_booking_ids;
  const affected = ids.length ? `Cancelled ${ids.length === 1 ? "booking" : "bookings"} ${ids.join(", ")}.` : "Nobody affected.";
  return e.action === "session_closed"
    ? `Closed ${e.session_name}. ${affected}`
    : `${e.session_name}: ${e.before.capacity} to ${e.after.capacity} places. ${affected}`;
}

/** Every capacity change and closure, newest first, with the reason the operator gave. */
export function ChangeLog({ log }: { log: ChangeLogEntry[] | null }) {
  return (
    <section className="panel op-log" aria-labelledby="log-title">
      <div className="panel-head">
        <div className="op-head">
          <div>
            <h2 id="log-title">Change log</h2>
            <p className="sub">Every capacity change and closure, newest first, with the reason given.</p>
          </div>
        </div>
      </div>
      <div className="panel-body">
        {log === null ? (
          <p className="empty">Loading the change log…</p>
        ) : log.length === 0 ? (
          <p className="empty">No changes yet.</p>
        ) : (
          <ul className="log">
            {log.map((e) => (
              <li key={e.id}>
                <span className="t">{hhmm(e.at)}</span>
                <span>
                  {describe(e)}
                  <br />
                  <span className="why">Reason: {e.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
