import { describe, expect, it } from "vitest";

import type { HeldPlace } from "../api";
import { operatorRope, type OpFloat } from "./rope";

const places = (n: number): HeldPlace[] =>
  Array.from({ length: n }, (_, i) => ({ booking_id: i + 1, swimmer_id: `swimmer-${i + 1}`, booked_at: "" }));

// "H" held, "L" loses its place, "." free, "|" the wall
const shape = (floats: OpFloat[]) =>
  floats.map((f) => (f.kind === "wall" ? "|" : f.kind === "free" ? "." : f.lose ? "L" : "H")).join("");

describe("operator rope", () => {
  it("puts the wall at the target, with the newest bookings past it", () => {
    expect(shape(operatorRope(places(5), 3))).toBe("HHH|LL");
  });

  it("shows free places up to the wall when everyone fits", () => {
    expect(shape(operatorRope(places(2), 5))).toBe("HH...|");
    expect(shape(operatorRope(places(0), 2))).toBe("..|");
  });

  it("keeps bookings in the order they were made", () => {
    const held = operatorRope(places(3), 2).filter((f) => f.kind === "held");
    expect(held.map((f) => f.place.booking_id)).toEqual([1, 2, 3]);
  });

  it("marks the last places before the wall red, never the ones past it", () => {
    const last = operatorRope(places(12), 10).map((f) => f.kind !== "wall" && f.last);
    expect(last).toEqual([false, false, false, false, false, false, false, false, true, true, false, false, false]);
  });
});
