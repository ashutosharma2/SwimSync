import { useEffect, useState } from "react";

import { MyBookingsPage } from "./pages/MyBookingsPage";
import { SessionsPage } from "./pages/SessionsPage";

const SWIMMERS = Array.from({ length: 12 }, (_, i) => `swimmer-${String(i + 1).padStart(2, "0")}`);

function storedSwimmer() {
  try {
    return localStorage.getItem("swimsync.swimmer") ?? "swimmer-07";
  } catch {
    return "swimmer-07";
  }
}

export function App() {
  const [page, setPage] = useState<"sessions" | "bookings">("sessions");
  const [swimmer, setSwimmer] = useState(storedSwimmer);
  // Bumped after any booking change, so both pages re-read the server's record.
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem("swimsync.swimmer", swimmer);
    } catch {
      // private browsing: the choice just isn't remembered
    }
  }, [swimmer]);

  const tab = (id: typeof page, label: string) => (
    <button
      onClick={() => setPage(id)}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        page === id ? "bg-deep text-white" : "text-slate-600 hover:bg-water-soft"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold text-deep">SwimSync</h1>
            <p className="text-xs text-slate-500">Fictional pool. A booking here always means a place.</p>
          </div>
          <nav className="flex gap-1">
            {tab("sessions", "Sessions")}
            {tab("bookings", "My bookings")}
          </nav>
        </div>
        <div className="border-t border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 text-xs text-amber-900">
            <span>You are</span>
            <select
              value={swimmer}
              onChange={(e) => setSwimmer(e.target.value)}
              className="rounded border border-amber-300 bg-white px-1.5 py-0.5"
            >
              {SWIMMERS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <span>Demo only: there's no login, so pick any swimmer.</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {page === "sessions" ? (
          <SessionsPage swimmer={swimmer} changes={changes} onChanged={() => setChanges((n) => n + 1)} onShowBookings={() => setPage("bookings")} />
        ) : (
          <MyBookingsPage swimmer={swimmer} changes={changes} onChanged={() => setChanges((n) => n + 1)} />
        )}
      </main>
    </div>
  );
}
