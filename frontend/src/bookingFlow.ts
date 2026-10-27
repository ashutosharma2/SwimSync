// The Book and Cancel buttons' rules, kept free of React so they can be tested on their own.
//
// The one rule above all others: never tell the swimmer "booked" or "not booked" without evidence.
// "Booked" needs the server's 201/200. "Not booked" needs every attempt to have definitely rolled
// back. Anything in between is "we're checking" or "we couldn't confirm yet".

import type { Answer, MyBooking } from "./api";

export type BookState =
  | { kind: "idle" }
  | { kind: "booking" }
  | { kind: "checking"; attempt: number }
  | { kind: "confirmed"; bookingId: number; how: "first try" | "retry" | "found in my bookings" }
  | { kind: "already"; bookingId?: number }
  | { kind: "full" }
  | { kind: "not_booked" }
  | { kind: "unknown"; detail: string }
  | { kind: "error"; message: string };

export interface BookDeps {
  post(key: string): Promise<Answer>;
  myBookings(): Promise<MyBooking[] | null>; // null if it couldn't be read
  sleep(ms: number): Promise<void>;
  newKey(): string;
  // Remembers the key across a page reload, so a reload mid-request resumes with the same key.
  pending: { load(): string | null; save(key: string): void; clear(): void };
}

export const UNAVAILABLE_RETRIES = 2;
export const UNAVAILABLE_DELAY_MS = 1000; // the server's Retry-After
export const UNKNOWN_DELAYS_MS = [1000, 2000, 4000];

type Verdict = "confirmed" | "already" | "full" | "unavailable" | "unknown" | "error";

export function classify(answer: Answer): Verdict {
  if (answer.status === null) return "unknown"; // timeout or network error: the server may have saved it
  const { status, body } = answer;
  if ((status === 200 || status === 201) && body?.booking_id != null) return "confirmed";
  if (status === 409 && body?.booking_id != null) return "already";
  if (status === 409 && body?.error === "session is full") return "full";
  if (status === 409) return "unknown"; // a request with the same key is still in progress
  if (status === 503 && body?.error === "database_unavailable") return "unavailable";
  if (status >= 500) return "unknown"; // outcome_unknown, or a proxy error: can't tell either way
  return "error"; // 404, 422: a bug or a bad request, not a booking outcome
}

export async function book(sessionId: number, deps: BookDeps, onState: (s: BookState) => void): Promise<BookState> {
  const key = deps.pending.load() ?? deps.newKey();
  deps.pending.save(key);
  const finish = (state: BookState, keepKey = false) => {
    if (!keepKey) deps.pending.clear();
    onState(state);
    return state;
  };

  onState({ kind: "booking" });
  let answer = await deps.post(key);
  let unavailableRetries = 0;
  let unknownRetries = 0;
  let everUncertain = false; // once any attempt might have saved it, a later "rolled back" proves nothing

  for (;;) {
    const verdict = classify(answer);
    const how = unknownRetries + unavailableRetries === 0 ? "first try" : "retry";

    if (verdict === "confirmed") return finish({ kind: "confirmed", bookingId: answer.status ? answer.body.booking_id : 0, how });
    if (verdict === "already") return finish({ kind: "already", bookingId: answer.status ? answer.body.booking_id : undefined });
    if (verdict === "full") return finish({ kind: "full" });
    if (verdict === "error") {
      const message = answer.status === 404 ? "That session no longer exists." : "Something's wrong with this request.";
      return finish({ kind: "error", message });
    }

    if (verdict === "unavailable" && !everUncertain) {
      if (unavailableRetries < UNAVAILABLE_RETRIES) {
        unavailableRetries++;
        await deps.sleep(UNAVAILABLE_DELAY_MS);
        answer = await deps.post(key);
        continue;
      }
      return finish({ kind: "not_booked" }); // every attempt definitely rolled back
    }

    // Unknown (or "unavailable" after an earlier unknown): keep asking with the SAME key.
    everUncertain = true;
    if (unknownRetries < UNKNOWN_DELAYS_MS.length) {
      onState({ kind: "checking", attempt: unknownRetries + 1 });
      await deps.sleep(UNKNOWN_DELAYS_MS[unknownRetries]);
      unknownRetries++;
      answer = await deps.post(key);
      continue;
    }

    // Retries ran out. Ask the record itself.
    const mine = await deps.myBookings();
    const found = mine?.find((b) => b.session_id === sessionId && b.status === "confirmed");
    if (found) return finish({ kind: "confirmed", bookingId: found.booking_id, how: "found in my bookings" });
    // No booking on record yet, or the record couldn't be read. The original request may still
    // finish, so keep the key: pressing the button again re-asks with it and can't double-book.
    const detail = mine === null ? "We couldn't reach your bookings either." : "There's no booking on record yet.";
    return finish({ kind: "unknown", detail }, true);
  }
}

export type CancelState =
  | { kind: "idle" }
  | { kind: "cancelling" }
  | { kind: "checking"; attempt: number }
  | { kind: "cancelled" }
  | { kind: "not_cancelled" }
  | { kind: "unknown" }
  | { kind: "error"; message: string };

export interface CancelDeps {
  post(): Promise<Answer>;
  myBookings(): Promise<MyBooking[] | null>;
  sleep(ms: number): Promise<void>;
}

// Cancelling is safe to repeat: the server releases the place only if the booking is still
// confirmed. So every uncertain answer is simply retried.
export async function cancel(bookingId: number, deps: CancelDeps, onState: (s: CancelState) => void): Promise<CancelState> {
  const finish = (s: CancelState) => (onState(s), s);
  onState({ kind: "cancelling" });
  let answer = await deps.post();
  let unavailableRetries = 0;
  let unknownRetries = 0;
  let everUncertain = false;

  for (;;) {
    if (answer.status === 200) return finish({ kind: "cancelled" });
    if (answer.status === 404) return finish({ kind: "error", message: "That booking wasn't found." });
    const definitelyNot = answer.status === 503 && answer.body?.error === "database_unavailable";
    if (definitelyNot && !everUncertain) {
      if (unavailableRetries < UNAVAILABLE_RETRIES) {
        unavailableRetries++;
        await deps.sleep(UNAVAILABLE_DELAY_MS);
        answer = await deps.post();
        continue;
      }
      return finish({ kind: "not_cancelled" });
    }
    everUncertain = true;
    if (unknownRetries < UNKNOWN_DELAYS_MS.length) {
      onState({ kind: "checking", attempt: unknownRetries + 1 });
      await deps.sleep(UNKNOWN_DELAYS_MS[unknownRetries]);
      unknownRetries++;
      answer = await deps.post();
      continue;
    }
    const mine = await deps.myBookings();
    const row = mine?.find((b) => b.booking_id === bookingId);
    if (row?.status === "cancelled") return finish({ kind: "cancelled" });
    return finish({ kind: "unknown" });
  }
}
