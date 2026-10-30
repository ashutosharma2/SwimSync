// The operator's rope: the session's bookings in the order they were made, with the wall at the
// capacity being considered. Unlike the swimmer's rope, each float is a real booking.

import type { HeldPlace } from "../api";
import { lastPlaces } from "../rope";

export type OpFloat =
  | { kind: "held"; place: HeldPlace; lose: boolean; last: boolean }
  | { kind: "free"; last: boolean }
  | { kind: "wall" };

/**
 * `places` is oldest first, as the API lists them. The wall goes at `target`; bookings past it are the
 * ones a cut would cancel. Places up to the wall that nobody holds are free. The last places before
 * the wall are red, as on the swimmer's screen.
 */
export function operatorRope(places: HeldPlace[], target: number): OpFloat[] {
  const floats: OpFloat[] = [];
  const slots = Math.max(target, places.length);
  const red = target - lastPlaces(target);
  for (let i = 0; i < slots; i++) {
    if (i === target) floats.push({ kind: "wall" });
    const last = i < target && i >= red;
    floats.push(i < places.length ? { kind: "held", place: places[i], lose: i >= target, last } : { kind: "free", last });
  }
  if (target >= slots) floats.push({ kind: "wall" });
  return floats;
}
