// A session drawn as a lane rope: one float per place, the wall at capacity.

export type Float = { kind: "free" | "booked" | "yours" | "checking"; last: boolean };

/** How many floats near the wall are red: the last places, about a fifth of the session, at least one. */
export const lastPlaces = (capacity: number) => Math.max(1, Math.round(capacity * 0.2));

/**
 * The floats for a session, from the left: yours first (or a checking float while a booking is in
 * flight), then everyone else's bookings, then the free places. The numbers come from the sessions
 * list, which may be a few seconds old, so they are clamped rather than trusted to add up.
 */
export function ropeModel(capacity: number, remaining: number, mine: boolean, pending: boolean): Float[] {
  const booked = Math.max(0, Math.min(capacity, capacity - remaining));
  let others = Math.max(0, Math.min(booked - (mine ? 1 : 0), pending ? capacity - 1 : capacity));
  const red = capacity - lastPlaces(capacity);
  return Array.from({ length: capacity }, (_, i): Float => {
    const last = i >= red;
    if (i === 0 && pending) return { kind: "checking", last };
    if (i === 0 && mine) return { kind: "yours", last };
    if (others > 0) {
      others--;
      return { kind: "booked", last };
    }
    return { kind: "free", last };
  });
}
