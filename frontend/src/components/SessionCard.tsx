import { useEffect, useRef, useState } from "react";

import { api, type MyBooking, type Session } from "../api";
import { book, type BookState } from "../bookingFlow";
import { bubblesBeside } from "../pool/floor";
import { ropeModel } from "../rope";
import { hhmm, sleep } from "../time";
import { FloatRope } from "./FloatRope";

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

// Results that only need saying for a moment. "unknown" stays until it's resolved.
const PASSING: BookState["kind"][] = ["confirmed", "already", "full", "closed", "not_booked", "error"];

type CardView = {
  pill?: [string, string];
  line: string;
  tone?: "good" | "warn" | "checking";
  action?: "book" | "check" | "pass";
  pending: boolean;
  mine: boolean;
};

/**
 * What a card says, from the session, the swimmer's own booking (from the record) and the state of
 * any booking in flight. "Booked" needs the server's yes or the record; anything uncertain says so.
 */
export function cardView(s: Session, state: BookState, mine: MyBooking | undefined, poolCut: boolean): CardView {
  const left = s.remaining;
  const placesLeft = left === 1 ? "1 place left." : `${left} of ${s.capacity} places left.`;
  if (state.kind === "booking") return { pill: ["checking", "Booking"], line: "Booking your place…", pending: true, mine: false };
  if (state.kind === "checking")
    return { pill: ["checking", "Checking"], line: "Not confirmed yet. Checking with the pool. Trying again can't book you twice.", tone: "checking", pending: true, mine: false };
  if (state.kind === "unknown" && !mine) {
    // bookingFlow's detail says whether the bookings record itself could be read
    const unreachable = state.detail.includes("couldn't reach");
    return {
      pill: ["checking", "Not confirmed"],
      line: unreachable
        ? "We couldn't confirm it yet, and couldn't reach your bookings either. Checking again can't book you twice."
        : "We couldn't confirm it yet, and there's no booking on record so far. Checking again can't book you twice.",
      tone: "checking", action: "check", pending: false, mine: false,
    };
  }
  if (mine || state.kind === "confirmed" || state.kind === "already") {
    const how = state.kind === "confirmed" ? state.how : null;
    return {
      pill: ["booked", "Booked"],
      line: how === "retry"
        ? "You're booked. The first answer didn't arrive, so the app asked again with the same request and the pool confirmed it."
        : how === "found in my bookings"
          ? "You're booked. The pool never answered in time, so the app checked your bookings and found it."
          : `You're booked. ${placesLeft}`,
      tone: how && how !== "first try" ? "good" : undefined,
      action: "pass", pending: false, mine: true,
    };
  }
  if (s.status === "closed" || state.kind === "closed")
    return { pill: ["closed", "Closed"], line: poolCut ? "Closed by the pool. Your booking was cancelled and you were sent a notice." : "Closed by the pool.", pending: false, mine: false };
  const prefix = poolCut ? "The pool reduced capacity and your booking was cancelled. " : "";
  // The Book button only shows while places are left, so "full" means someone got there first.
  if (state.kind === "full") return { pill: ["full", "Full"], line: "That last place just went. Someone booked it a moment before you.", tone: "warn", pending: false, mine: false };
  if (left <= 0) return { pill: ["full", "Full"], line: prefix + "Full. A place opens if someone cancels.", pending: false, mine: false };
  if (state.kind === "not_booked")
    return { line: "You're not booked. The pool's system didn't answer, and nothing was saved. Try again in a moment.", tone: "warn", action: "book", pending: false, mine: false };
  if (state.kind === "error") return { line: `${state.message} Nothing was booked.`, tone: "warn", action: "book", pending: false, mine: false };
  return { line: prefix + placesLeft, action: "book", pending: false, mine: false };
}

export function SessionCard({ session, swimmer, mine, poolCut, onChanged, onShowPass }: {
  session: Session;
  swimmer: string;
  mine: MyBooking | undefined;
  poolCut: boolean;
  onChanged: () => void;
  onShowPass: (bookingId: number | null) => void;
}) {
  const [state, setState] = useState<BookState>({ kind: "idle" });
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!PASSING.includes(state.kind)) return;
    const timer = setTimeout(() => setState({ kind: "idle" }), 12_000);
    return () => clearTimeout(timer);
  }, [state]);

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
    if (result.kind === "confirmed") bubblesBeside(card.current); // the pool answers only after the server said yes
    if (result.kind !== "error") onChanged(); // re-read the server's numbers either way
  }

  const view = cardView(session, state, mine, poolCut);
  const closed = session.status === "closed";
  const bookingId = mine?.booking_id ?? (state.kind === "confirmed" ? state.bookingId : state.kind === "already" ? (state.bookingId ?? null) : null);

  return (
    <article ref={card} className={`session${closed ? " closed" : ""}`}>
      <div className="s-top">
        <span className="t time">{hhmm(session.starts_at)}</span>
        <h3 className="s-name">{session.name}</h3>
        {view.pill ? <span className={`pill ${view.pill[0]}`}>{view.pill[1]}</span> : null}
      </div>
      {closed ? null : <FloatRope floats={ropeModel(session.capacity, session.remaining, view.mine, view.pending)} />}
      <div className="s-foot">
        <p className={`line${view.tone ? ` ${view.tone}` : ""}`} aria-live="polite">{view.line}</p>
        {view.action === "book" ? (
          <button className="btn" onClick={onBook}>Book</button>
        ) : view.action === "check" ? (
          <button className="btn" onClick={onBook}>Check again</button>
        ) : view.action === "pass" ? (
          <button className="btn ghost" onClick={() => onShowPass(bookingId)}>Show your pass</button>
        ) : null}
      </div>
    </article>
  );
}
