// Talking to the booking API through Vite's /api proxy.

/** What came back: an HTTP answer, or nothing at all (network error or our own timeout). */
export type Answer =
  | { status: number; body: any }
  | { status: null; error: string };

export type Session = { id: number; name: string; starts_at: string; capacity: number; remaining: number; status: "open" | "closed" };
export type CancelReason = "swimmer" | "capacity_reduced" | "session_closed";
export type MyBooking = { booking_id: number; session_id: number; session_name: string; starts_at: string; status: "confirmed" | "cancelled"; cancel_reason?: CancelReason | null };
export type Notice = { id: number; message: string; created_at: string };

// What the operator's read endpoints return
export type HeldPlace = { booking_id: number; swimmer_id: string; booked_at: string };
export type SessionPlaces = { session_id: number; name: string; capacity: number; booked: number; status: "open" | "closed"; bookings: HeldPlace[] };
export type ChangeLogEntry = {
  id: number;
  at: string;
  action: "capacity_changed" | "session_closed";
  session_name: string;
  reason: string;
  before: Record<string, number | string>;
  after: Record<string, number | string>;
  affected_booking_ids: number[];
};

// The app stops waiting after 4 s. The server may still finish the work, which is why a lost answer
// is treated as "unknown", never as "failed".
const CLIENT_TIMEOUT_MS = 4000;

export async function call(
  method: string,
  path: string,
  swimmerId?: string,
  idempotencyKey?: string,
  extra: { operatorToken?: string; body?: unknown } = {},
): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (swimmerId) headers["X-Swimmer-Id"] = swimmerId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (extra.operatorToken) headers["X-Operator-Token"] = extra.operatorToken;
  if (extra.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`/api${path}`, {
      method,
      headers,
      body: extra.body === undefined ? undefined : JSON.stringify(extra.body),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    const isJson = response.headers.get("content-type")?.includes("application/json");
    return { status: response.status, body: isJson ? await response.json() : null };
  } catch (exc) {
    return { status: null, error: exc instanceof Error ? exc.name : "NetworkError" };
  }
}

export const api = {
  sessions: () => call("GET", "/sessions"),
  book: (sessionId: number, swimmerId: string, key: string) =>
    call("POST", `/sessions/${sessionId}/bookings`, swimmerId, key),
  cancel: (bookingId: number, swimmerId: string) => call("POST", `/bookings/${bookingId}/cancel`, swimmerId),
  myBookings: (swimmerId: string) => call("GET", "/me/bookings", swimmerId),
  notifications: (swimmerId: string) => call("GET", "/me/notifications", swimmerId),
};

/** The operator's calls. Each carries the operator token; the API refuses them without it. */
export const operatorApi = {
  places: (sessionId: number, operatorToken: string) =>
    call("GET", `/operator/sessions/${sessionId}/bookings`, undefined, undefined, { operatorToken }),
  changeLog: (operatorToken: string) => call("GET", "/operator/audit", undefined, undefined, { operatorToken }),
  setCapacity: (sessionId: number, capacity: number, reason: string, operatorToken: string) =>
    call("POST", `/operator/sessions/${sessionId}/capacity`, undefined, undefined, { operatorToken, body: { capacity, reason } }),
  close: (sessionId: number, reason: string, operatorToken: string) =>
    call("POST", `/operator/sessions/${sessionId}/close`, undefined, undefined, { operatorToken, body: { reason } }),
};
