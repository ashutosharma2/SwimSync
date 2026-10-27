import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { api, type MyBooking } from "../api";
import { cancel, type CancelState } from "../bookingFlow";
import { formatWhen, sleep } from "../time";

const CANCEL_NOTE: Partial<Record<CancelState["kind"], [string, string]>> = {
  checking: ["Not sure the cancel went through. Checking; repeating it is safe.", "text-amber-800 checking"],
  not_cancelled: ["Couldn't reach bookings. Your booking is still confirmed.", "text-rose-700"],
  unknown: ["We couldn't confirm the cancel yet. Check again in a moment.", "text-amber-800"],
  error: ["That booking wasn't found.", "text-rose-700"],
};

/** A confirmed booking as a ticket, with a QR code the front desk could scan. */
export function SwimPass({ booking, swimmer, onChanged }: { booking: MyBooking; swimmer: string; onChanged: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<CancelState>({ kind: "idle" });
  const active = booking.status === "confirmed";

  useEffect(() => {
    QRCode.toDataURL(`SWIMSYNC-BOOKING-${booking.booking_id}`, { margin: 1, width: 96 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [booking.booking_id]);

  async function onCancel() {
    const result = await cancel(
      booking.booking_id,
      {
        post: () => api.cancel(booking.booking_id, swimmer),
        myBookings: async () => {
          const answer = await api.myBookings(swimmer);
          return answer.status === 200 ? answer.body : null;
        },
        sleep,
      },
      setState,
    );
    if (result.kind === "cancelled" || result.kind === "unknown") onChanged();
  }

  const busy = state.kind === "cancelling" || state.kind === "checking";
  const note = CANCEL_NOTE[state.kind];

  return (
    <article
      className={`flex items-center justify-between gap-4 rounded-xl border p-4 ${
        active ? "border-water bg-white" : "border-slate-200 bg-slate-100 text-slate-500"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-xs font-medium ${active ? "text-water" : ""}`}>{active ? "Swim pass" : "Cancelled"}</p>
        <p className="font-semibold">{booking.session_name}</p>
        <p className="text-sm tabular-nums">
          {formatWhen(booking.starts_at)} · booking {booking.booking_id}
        </p>
        {note ? <p className={`mt-1 text-sm ${note[1]}`}>{note[0]}</p> : null}
        {active ? (
          <button
            onClick={onCancel}
            disabled={busy}
            className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {state.kind === "cancelling" ? "Cancelling…" : state.kind === "checking" ? "Checking…" : "Cancel booking"}
          </button>
        ) : null}
      </div>
      {active && qr ? <img src={qr} alt={`QR code for booking ${booking.booking_id}`} className="size-24 shrink-0" /> : null}
    </article>
  );
}
