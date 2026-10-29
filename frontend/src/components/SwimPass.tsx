import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { api, type MyBooking } from "../api";
import { cancel, type CancelState } from "../bookingFlow";
import { dayLabel, hhmm, sleep } from "../time";

const CANCEL_NOTE: Partial<Record<CancelState["kind"], string>> = {
  checking: "Not sure the cancel went through. Checking; repeating it is safe.",
  not_cancelled: "Couldn't reach the pool's system. Your booking is still confirmed.",
  unknown: "We couldn't confirm the cancel yet. Check again in a moment.",
  error: "That booking wasn't found.",
};

/** A confirmed booking as a ticket, with a QR code the front desk could scan. */
export function SwimPass({ booking, swimmer, open, onChanged }: { booking: MyBooking; swimmer: string; open: boolean; onChanged: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<CancelState>({ kind: "idle" });
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    QRCode.toDataURL(`SWIMSYNC-BOOKING-${booking.booking_id}`, { margin: 1, width: 88, color: { dark: "#0F2A3A", light: "#FFFFFF" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [booking.booking_id]);

  useEffect(() => {
    if (open) card.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [open]);

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
    <article ref={card} className={`pass${open ? " open" : ""}`}>
      <div>
        <span className="t">{hhmm(booking.starts_at)}</span>
        <h3>{booking.session_name}</h3>
        <p>{dayLabel(booking.starts_at)}. Booking {booking.booking_id} for {swimmer}.</p>
        <p>Show this at the desk.</p>
        {note ? <p className="pass-note" aria-live="polite">{note}</p> : null}
        <button className="btn" onClick={onCancel} disabled={busy}>
          {state.kind === "cancelling" ? "Cancelling…" : state.kind === "checking" ? "Checking…" : "Cancel booking"}
        </button>
      </div>
      <div className="qr">{qr ? <img src={qr} alt={`QR code for booking ${booking.booking_id}`} /> : `Booking ${booking.booking_id}`}</div>
    </article>
  );
}
