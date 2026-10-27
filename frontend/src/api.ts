// Talking to the booking API through Vite's /api proxy.

/** What came back: an HTTP answer, or nothing at all (network error or our own timeout). */
export type Answer =
  | { status: number; body: any }
  | { status: null; error: string };

export type Session = { id: number; name: string; starts_at: string; capacity: number; remaining: number };
export type MyBooking = { booking_id: number; session_id: number; session_name: string; starts_at: string; status: "confirmed" | "cancelled" };
export type Notice = { id: number; message: string; created_at: string };

// The app stops waiting after 4 s. The server may still finish the work, which is why a lost answer
// is treated as "unknown", never as "failed".
const CLIENT_TIMEOUT_MS = 4000;

export async function call(method: string, path: string, swimmerId?: string, idempotencyKey?: string): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (swimmerId) headers["X-Swimmer-Id"] = swimmerId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const response = await fetch(`/api${path}`, { method, headers, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) });
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
