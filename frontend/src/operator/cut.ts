// The operator's capacity change, worked out before it's sent, and the answer described after.
// Free of React so it can be tested on its own, like bookingFlow.ts.

import type { Answer, HeldPlace } from "../api";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
