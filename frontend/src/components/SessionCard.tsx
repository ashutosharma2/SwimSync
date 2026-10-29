import { useState } from "react";

import { api, type MyBooking, type Session } from "../api";
import { book, type BookState } from "../bookingFlow";
import { formatWhen, sleep } from "../time";
import { CrowdChip, WaterMeter } from "./WaterMeter";

function pendingStore(swimmer: string, sessionId: number) {
  const slot = `swimsync.pending.${swimmer}.${sessionId}`;
  return {
    load: () => sessionStorage.getItem(slot),
    save: (key: string) => sessionStorage.setItem(slot, key),
    clear: () => sessionStorage.removeItem(slot),
  };
}

async function readMyBookings(swimmer: string): Promise<MyBooking[] | null> {
  const answer = await api.myBookings(swimmer);
  return answer.status === 200 ? answer.body : null;
}

const BUTTON: Partial<Record<BookState["kind"], string>> = {
  booking: "Booking…",
  checking: "Checking…",
  confirmed: "You're in",
  already: "You're in",
  not_booked: "Try again",
  unknown: "Check again",
};

function message(state: BookState): [string, string] | null {
  switch (state.kind) {
    case "checking":
      return [`Not sure that went through. Checking with the same request (${state.attempt} of 3), so it can't book twice.`, "text-amber-800"];
    case "confirmed":
      return state.how === "first try"
        ? ["Booked. Your swim pass is in My bookings.", "text-emerald-700"]
        : state.how === "retry"
          ? ["Booked. A retry got the answer, and no duplicate was made.", "text-emerald-700"]
          : ["Booked. We found it in your bookings.", "text-emerald-700"];
    case "already":
      return ["You already have this swim.", "text-emerald-700"];
    case "full":
      return ["That last place just went.", "text-amber-800"];
    case "closed":
      return ["The pool closed this session.", "text-amber-800"];
    case "not_booked":
      return ["Couldn't reach bookings. You're not booked.", "text-rose-700"];
    case "unknown":
      return [`We couldn't confirm yet. ${state.detail} Check again is safe: it can't book twice.`, "text-amber-800"];
    case "error":
      return [state.message, "text-rose-700"];
    default:
      return null;
  }
}

export function SessionCard({ session, swimmer, onChanged, onShowBookings }: {
  session: Session;
  swimmer: string;
  onChanged: () => void;
  onShowBookings: () => void;
}) {
  const [state, setState] = useState<BookState>({ kind: "idle" });
  const [ripple, setRipple] = useState(0);
  const booked = session.capacity - session.remaining;
  const busy = state.kind === "booking" || state.kind === "checking";
  const finished = state.kind === "confirmed" || state.kind === "already";
  const isClosed = session.status === "closed" || state.kind === "closed";
  const canPress = !busy && !finished && !isClosed && (session.remaining > 0 || state.kind === "unknown");

  async function onBook() {
    const result = await book(
      session.id,
      {
        post: (key) => api.book(session.id, swimmer, key),
        myBookings: () => readMyBookings(swimmer),
        sleep,
        newKey: () => crypto.randomUUID(),
        pending: pendingStore(swimmer, session.id),
      },
      setState,
    );
    if (result.kind === "confirmed") setRipple((n) => n + 1);
    if (result.kind !== "error") onChanged(); // re-read the server's numbers either way
  }

  const note = message(state);
  const label = BUTTON[state.kind] ?? (isClosed ? "Closed" : session.remaining > 0 ? "Book" : "Fully booked");

  return (
    <article className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <WaterMeter booked={booked} capacity={session.capacity} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <span className="tabular-nums">{formatWhen(session.starts_at)}</span> · {session.name}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          {isClosed ? "Closed by the pool" : session.remaining > 0 ? `${session.remaining} of ${session.capacity} places left` : "Fully booked"}
        </p>
        <div className="mt-1.5">
          <CrowdChip booked={booked} capacity={session.capacity} />
        </div>
        {note ? <p className={`mt-2 text-sm ${note[1]} ${state.kind === "checking" ? "checking" : ""}`}>{note[0]}</p> : null}
        {finished ? (
          <button onClick={onShowBookings} className="mt-1 text-sm font-medium text-water underline-offset-2 hover:underline">
            See your swim pass
          </button>
        ) : null}
      </div>
      <button
        key={ripple}
        onClick={onBook}
        disabled={!canPress}
        aria-busy={busy}
        className={`min-w-28 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
          finished
            ? "bg-emerald-600 text-white ripple"
            : canPress
              ? "bg-deep text-white hover:bg-water"
              : "bg-slate-200 text-slate-500"
        } ${state.kind === "checking" ? "checking" : ""}`}
      >
        {label}
      </button>
    </article>
  );
}
