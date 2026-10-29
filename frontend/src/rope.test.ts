import { describe, expect, it } from "vitest";

import { lastPlaces, ropeModel } from "./rope";

const kinds = (capacity: number, remaining: number, mine = false, pending = false) =>
  ropeModel(capacity, remaining, mine, pending).map((f) => f.kind);

describe("rope", () => {
  it("has one float per place", () => {
    expect(ropeModel(24, 15, false, false)).toHaveLength(24);
  });

  it("puts your float first, then other bookings, then free places", () => {
    expect(kinds(5, 2, true)).toEqual(["yours", "booked", "booked", "free", "free"]);
  });

  it("shows a checking float first while a booking is in flight", () => {
    expect(kinds(4, 2, false, true)).toEqual(["checking", "booked", "booked", "free"]);
  });

  it("marks about a fifth of the places, at least one, as the last places", () => {
    expect(lastPlaces(20)).toBe(4);
    expect(lastPlaces(5)).toBe(1);
    expect(lastPlaces(3)).toBe(1);
    expect(ropeModel(10, 10, false, false).map((f) => f.last)).toEqual([false, false, false, false, false, false, false, false, true, true]);
  });

  it("copes with numbers that don't add up, since the list can be a few seconds old", () => {
    expect(kinds(3, 3, true)).toEqual(["yours", "free", "free"]); // booked, but the count hasn't caught up
    expect(kinds(3, -2)).toEqual(["booked", "booked", "booked"]); // never more floats than places
  });
});
