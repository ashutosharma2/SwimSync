import { describe, expect, it } from "vitest";

import type { HeldPlace } from "../api";
import { cutPreview, writeOutcome } from "./cut";

const places = (...swimmers: string[]): HeldPlace[] =>
  swimmers.map((swimmer_id, i) => ({ booking_id: i + 1, swimmer_id, booked_at: "" }));

describe("cut preview", () => {
  it("cancels the newest bookings first, the same order as the server", () => {
    const p = cutPreview(places("ana", "ben", "cai", "dev", "eva"), 5, 3);
    expect(p.losing.map((x) => x.swimmer_id)).toEqual(["eva", "dev"]);
    expect(p.label).toBe("Cut to 3 and cancel 2 bookings");
    expect(p.line).toContain("The 2 newest bookings lose their place: eva, dev.");
  });

  it("names one booking in the singular", () => {
    const p = cutPreview(places("ana", "ben"), 2, 1);
    expect(p.label).toBe("Cut to 1 and cancel 1 booking");
    expect(p.line).toContain("The newest booking loses its place: ben.");
  });

  it("cancels nobody when everyone still fits, or when capacity goes up", () => {
    expect(cutPreview(places("ana", "ben"), 10, 4)).toMatchObject({ losing: [], label: "Change to 4 places", changes: true });
    expect(cutPreview(places("ana"), 4, 6).line).toBe("Raising capacity cancels nobody and brings nobody back.");
  });

  it("says no change when the slider is at the current capacity", () => {
    expect(cutPreview(places("ana"), 4, 4)).toMatchObject({ label: "No change", changes: false });
  });
});

describe("write outcome", () => {
  it("is done only on a 200 that changed something", () => {
    expect(writeOutcome({ status: 200, body: { changed: true, cancelled_booking_ids: [5, 4] } })).toEqual({ kind: "done", cancelled: [5, 4] });
    expect(writeOutcome({ status: 200, body: { changed: false, cancelled_booking_ids: [] } })).toEqual({ kind: "unchanged" });
  });

  it("says not changed only when the database failed before the transaction", () => {
    expect(writeOutcome({ status: 503, body: { error: "database_unavailable", changed: false } }).kind).toBe("not_changed");
  });

  it("treats a lost reply or a failed commit as unknown, never as a failure", () => {
    expect(writeOutcome({ status: null, error: "TimeoutError" }).kind).toBe("unknown");
    expect(writeOutcome({ status: 503, body: { error: "outcome_unknown" } }).kind).toBe("unknown");
    expect(writeOutcome({ status: 502, body: null }).kind).toBe("unknown");
  });

  it("recognises a refused token, a closed or missing session and a bad request", () => {
    expect(writeOutcome({ status: 403, body: { error: "operator access required" } }).kind).toBe("refused");
    expect(writeOutcome({ status: 409, body: { error: "session is closed" } }).kind).toBe("closed");
    expect(writeOutcome({ status: 404, body: { error: "session not found" } }).kind).toBe("missing");
    expect(writeOutcome({ status: 422, body: {} }).kind).toBe("invalid");
  });
});
