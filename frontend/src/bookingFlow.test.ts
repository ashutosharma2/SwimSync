import { describe, expect, it } from "vitest";

import type { Answer, MyBooking } from "./api";
import { book, cancel, type BookState, UNKNOWN_DELAYS_MS } from "./bookingFlow";

const SESSION = 3;
const ok = (id: number, status = 201): Answer => ({ status, body: { booking_id: id, session_id: SESSION, status: "confirmed" } });
const full: Answer = { status: 409, body: { error: "session is full" } };
const already: Answer = { status: 409, body: { error: "you already have a confirmed booking for this session", booking_id: 7 } };
const unavailable: Answer = { status: 503, body: { error: "database_unavailable", booked: false } };
const unknown: Answer = { status: 503, body: { error: "outcome_unknown" } };
const timeout: Answer = { status: null, error: "TimeoutError" };
const mine = (status: "confirmed" | "cancelled", id = 42): MyBooking[] => [
  { booking_id: id, session_id: SESSION, session_name: "Evening family swim", starts_at: "", status },
];

/** Fake dependencies: answers come from a script, sleeps are instant and recorded. */
function harness(answers: Answer[], myBookings: MyBooking[] | null = [], savedKey: string | null = null) {
  const keysSent: string[] = [];
  const sleeps: number[] = [];
  const states: BookState[] = [];
  let stored = savedKey;
  let keyCounter = 0;
  const deps = {
    post: async (key: string) => {
      keysSent.push(key);
      const next = answers.shift();
      if (!next) throw new Error("no scripted answer left");
      return next;
    },
    myBookings: async () => myBookings,
    sleep: async (ms: number) => void sleeps.push(ms),
    newKey: () => `key-${++keyCounter}`,
    pending: { load: () => stored, save: (k: string) => void (stored = k), clear: () => void (stored = null) },
  };
  return { deps, keysSent, sleeps, states, onState: (s: BookState) => void states.push(s), stored: () => stored };
}

describe("booking", () => {
  it("201 confirms on the first try and forgets the key", async () => {
    const h = harness([ok(42)]);
    const result = await book(SESSION, h.deps, h.onState);
    expect(result).toEqual({ kind: "confirmed", bookingId: 42, how: "first try" });
    expect(h.states.map((s) => s.kind)).toEqual(["booking", "confirmed"]);
    expect(h.stored()).toBeNull();
  });

  it("never says booked before the server confirms", async () => {
    const h = harness([unknown, ok(42, 200)]);
    await book(SESSION, h.deps, h.onState);
    const firstConfirmed = h.states.findIndex((s) => s.kind === "confirmed");
    expect(firstConfirmed).toBe(h.states.length - 1);
  });

  it("full and already-booked are final answers", async () => {
    expect((await book(SESSION, harness([full]).deps, () => {})).kind).toBe("full");
    expect(await book(SESSION, harness([already]).deps, () => {})).toEqual({ kind: "already", bookingId: 7 });
  });

  it("database unavailable: two quiet retries, then a definite 'not booked'", async () => {
    const h = harness([unavailable, unavailable, unavailable]);
    const result = await book(SESSION, h.deps, h.onState);
    expect(result.kind).toBe("not_booked");
    expect(h.sleeps).toEqual([1000, 1000]);
    expect(h.stored()).toBeNull();
  });

  it("database unavailable, then recovered: booked on a retry with the same key", async () => {
    const h = harness([unavailable, ok(42)]);
    const result = await book(SESSION, h.deps, h.onState);
    expect(result).toEqual({ kind: "confirmed", bookingId: 42, how: "retry" });
    expect(new Set(h.keysSent).size).toBe(1);
  });

  it("outcome unknown: checks with the same key until the stored answer comes back", async () => {
    const h = harness([unknown, timeout, ok(42, 200)]);
    const result = await book(SESSION, h.deps, h.onState);
    expect(result).toEqual({ kind: "confirmed", bookingId: 42, how: "retry" });
    expect(h.keysSent).toEqual(["key-1", "key-1", "key-1"]);
    expect(h.states.filter((s) => s.kind === "checking").length).toBe(2);
    expect(h.sleeps).toEqual(UNKNOWN_DELAYS_MS.slice(0, 2));
  });

  it("unknown, then 'unavailable' is NOT proof of 'not booked': the first attempt may have saved it", async () => {
    const h = harness([unknown, unavailable, unavailable, unavailable], mine("confirmed"));
    const result = await book(SESSION, h.deps, h.onState);
    expect(result).toEqual({ kind: "confirmed", bookingId: 42, how: "found in my bookings" });
  });

  it("retries run out: my bookings is the record and decides", async () => {
    const h = harness([unknown, unknown, unknown, unknown], mine("confirmed"));
    expect(await book(SESSION, h.deps, h.onState)).toEqual({ kind: "confirmed", bookingId: 42, how: "found in my bookings" });
  });

  it("no booking on record yet: says 'unknown', not 'failed', and keeps the key for a safe re-ask", async () => {
    const h = harness([unknown, unknown, unknown, unknown], []);
    const result = await book(SESSION, h.deps, h.onState);
    expect(result).toEqual({ kind: "unknown", detail: "There's no booking on record yet." });
    expect(h.stored()).toBe("key-1");
  });

  it("a reload mid-request resumes with the saved key instead of making a new one", async () => {
    const h = harness([ok(42, 200)], [], "key-from-before-reload");
    await book(SESSION, h.deps, h.onState);
    expect(h.keysSent).toEqual(["key-from-before-reload"]);
  });

  it("404 and 422 are errors, not booking outcomes", async () => {
    expect((await book(SESSION, harness([{ status: 404, body: {} }]).deps, () => {})).kind).toBe("error");
    expect((await book(SESSION, harness([{ status: 422, body: {} }]).deps, () => {})).kind).toBe("error");
  });
});

describe("cancelling", () => {
  const deps = (answers: Answer[], list: MyBooking[] | null = []) => ({
    post: async () => answers.shift() as Answer,
    myBookings: async () => list,
    sleep: async () => {},
  });

  it("200 cancels, including a repeat ('already cancelled' is also a 200)", async () => {
    expect((await cancel(42, deps([{ status: 200, body: { already_cancelled: true } }]), () => {})).kind).toBe("cancelled");
  });

  it("unknown answers are retried, since the server releases the place only once", async () => {
    expect((await cancel(42, deps([unknown, timeout, { status: 200, body: {} }]), () => {})).kind).toBe("cancelled");
  });

  it("database unavailable throughout: definitely not cancelled", async () => {
    expect((await cancel(42, deps([unavailable, unavailable, unavailable]), () => {})).kind).toBe("not_cancelled");
  });

  it("retries run out: the record decides", async () => {
    expect((await cancel(42, deps([unknown, unknown, unknown, unknown], mine("cancelled")), () => {})).kind).toBe("cancelled");
    expect((await cancel(42, deps([unknown, unknown, unknown, unknown], mine("confirmed")), () => {})).kind).toBe("unknown");
  });
});
