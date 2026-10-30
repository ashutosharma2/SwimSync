// The operator's capacity change, worked out before it's sent, and the answer described after.
// Free of React so it can be tested on its own, like bookingFlow.ts.

import type { Answer, HeldPlace } from "../api";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What changing a session to `target` places would do. `places` is oldest booking first, as the API
 * lists them. A cut cancels the newest bookings first, so the ones at positions `target` and beyond
 * lose their place, and they're listed newest first: the order the server cancels them in.
 */
export function cutPreview(places: HeldPlace[], capacity: number, target: number) {
  const losing = places.slice(target).reverse();
  const label = target === capacity ? "No change" : losing.length ? `Cut to ${target} and cancel ${plural(losing.length, "booking", "bookings")}` : `Change to ${target} places`;
  const line =
    target === capacity
      ? "Drag the slider to choose a new capacity."
      : losing.length === 0
        ? target > capacity
          ? "Raising capacity cancels nobody and brings nobody back."
          : "Still room for everyone booked. Nobody loses their place."
        : `The ${losing.length === 1 ? "newest booking loses its" : `${losing.length} newest bookings lose their`} place: ${losing.map((p) => p.swimmer_id).join(", ")}. Each swimmer gets a notice saying the pool reduced capacity.`;
  return { losing, label, line, changes: target !== capacity };
}

export type WriteOutcome =
  | { kind: "done"; cancelled: number[] }
  | { kind: "unchanged" } // it was already that way
  | { kind: "not_changed" } // the database didn't answer before the transaction; nothing was saved
  | { kind: "unknown" } // the reply was lost or the commit failed: it may or may not have been saved
  | { kind: "refused" } // the token wasn't accepted
  | { kind: "closed" }
  | { kind: "missing" }
  | { kind: "invalid" };

/** What an answer to a capacity change or a closure means. Never "done" or "not changed" without evidence. */
export function writeOutcome(answer: Answer): WriteOutcome {
  if (answer.status === null) return { kind: "unknown" }; // timeout or network error
  const { status, body } = answer;
  if (status === 200) return body?.changed ? { kind: "done", cancelled: body.cancelled_booking_ids ?? [] } : { kind: "unchanged" };
  if (status === 403) return { kind: "refused" };
  if (status === 404) return { kind: "missing" };
  if (status === 409 && body?.error === "session is closed") return { kind: "closed" };
  if (status === 422) return { kind: "invalid" };
  if (status === 503 && body?.error === "database_unavailable") return { kind: "not_changed" };
  return { kind: "unknown" }; // outcome_unknown, a proxy error, anything else
}

/** The change the operator asked for, for the line that describes what happened. */
export type Change = { kind: "capacity"; name: string; target: number } | { kind: "close"; name: string };

export type ResultLine = { text: string; bad: boolean; done: boolean };

const cancelledLine = (n: number) =>
  n ? `${plural(n, "booking", "bookings")} cancelled; the notices are in the outbox.` : "Nobody lost their place.";

/** What to tell the operator after an answer. "unknown" gets a holding line until the session is read back. */
export function resultLine(change: Change, outcome: WriteOutcome): ResultLine {
  const bad = (text: string): ResultLine => ({ text, bad: true, done: false });
  switch (outcome.kind) {
    case "done":
      return {
        text: change.kind === "capacity" ? `Done. ${change.name} now has ${change.target} places. ${cancelledLine(outcome.cancelled.length)}` : `Closed ${change.name}. ${cancelledLine(outcome.cancelled.length)}`,
        bad: false,
        done: true,
      };
    case "unchanged":
      return { text: change.kind === "capacity" ? "Nothing to change." : `${change.name} was already closed.`, bad: false, done: false };
    case "not_changed":
      return bad("Not changed. The database is unavailable, and nothing was saved. Try again in a moment.");
    case "closed":
      return bad(`${change.name} is closed, so it can't be changed.`);
    case "missing":
      return bad("That session no longer exists.");
    case "invalid":
      return bad("The server didn't accept that change. Capacity must be 1 to 500 and the reason up to 200 characters.");
    case "refused":
      return bad("The operator token wasn't accepted.");
    case "unknown":
      return bad("No reply. Checking the session…");
  }
}

/**
 * After a lost reply, the session read back decides what to say: done only if it now shows the change.
 * If it doesn't, the change may still be in flight, so it's "not confirmed", never "failed". Repeating
 * is safe because a change names an end state ("capacity is 3"), not a step.
 */
export function afterUnknown(change: Change, reread: Answer): ResultLine {
  if (reread.status !== 200) {
    return { text: `Couldn't confirm. No reply, and ${change.name} couldn't be read back. Check the change log before trying again; repeating the same change is safe.`, bad: true, done: false };
  }
  const s = reread.body;
  const matches = change.kind === "capacity" ? s.capacity === change.target && s.status === "open" : s.status === "closed";
  if (matches) {
    return { text: change.kind === "capacity" ? `Done. The reply was lost, but ${change.name} now has ${change.target} places.` : `Done. The reply was lost, but ${change.name} now shows as closed.`, bad: false, done: true };
  }
  const now = s.status === "closed" ? "shows as closed" : `still shows ${s.capacity} places`;
  return { text: `Not confirmed. No reply, and ${change.name} ${now}. Check again in a moment; repeating the same change is safe.`, bad: true, done: false };
}
