import { useEffect, useState } from "react";

import { api, type MyBooking } from "../api";
import { SwimPass } from "../components/SwimPass";

export function MyBookingsPage({ swimmer, changes, onChanged }: { swimmer: string; changes: number; onChanged: () => void }) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let stopped = false;
    api.myBookings(swimmer).then((answer) => {
      if (stopped) return;
      if (answer.status === 200) {
        setBookings(answer.body);
        setUnreachable(false);
      } else {
        setUnreachable(true);
      }
    });
    return () => {
      stopped = true;
    };
  }, [swimmer, changes]);

  const confirmed = bookings?.filter((b) => b.status === "confirmed") ?? [];
  const cancelled = bookings?.filter((b) => b.status === "cancelled") ?? [];

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">My bookings</h2>
      <p className="mb-4 text-xs text-slate-500">This list comes straight from the booking record, so it's the final word on what you've booked.</p>

      {unreachable ? <p className="mb-3 text-sm text-amber-800">Can't reach the booking server right now.</p> : null}
      {bookings === null ? (
        unreachable ? null : <p className="text-sm text-slate-500">Loading your bookings…</p>
      ) : bookings.length === 0 ? (
        <p className="text-sm text-slate-600">No swims booked yet. Pick a session from the Sessions tab.</p>
      ) : (
        <div className="grid gap-3">
          {[...confirmed, ...cancelled].map((b) => (
            <SwimPass key={b.booking_id} booking={b} swimmer={swimmer} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  );
}
