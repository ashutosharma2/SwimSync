import { useEffect, useState } from "react";

import { PoolFloor } from "./components/PoolFloor";
import { PoolHeader } from "./components/PoolHeader";
import { BookingsHead, MyBookingsPage } from "./pages/MyBookingsPage";
import { SessionsHead, SessionsPage } from "./pages/SessionsPage";
import { useSettings, type Theme } from "./settings";
import { useSwimmerData } from "./useSwimmerData";

const SWIMMERS = Array.from({ length: 12 }, (_, i) => `swimmer-${String(i + 1).padStart(2, "0")}`);
const THEMES: [Theme, string][] = [["device", "Match device"], ["light", "Light"], ["dark", "Night pool"]];

function storedSwimmer() {
  try {
    return localStorage.getItem("swimsync.swimmer") ?? "swimmer-07";
  } catch {
    return "swimmer-07";
  }
}

/** The swimmer's screen: phone-first, one panel with two tabs. */
export function App() {
  const [tab, setTab] = useState<"sessions" | "bookings">("sessions");
  const [swimmer, setSwimmer] = useState(storedSwimmer);
  // Bumped after any booking change, so the data is read again straight away.
  const [changes, setChanges] = useState(0);
  const [openPass, setOpenPass] = useState<number | null>(null);
  const settings = useSettings();
  const { sessions, mine, notices, asOf, stale } = useSwimmerData(swimmer, changes);

  useEffect(() => {
    try {
      localStorage.setItem("swimsync.swimmer", swimmer);
    } catch {
      // private browsing: the choice just isn't remembered
    }
  }, [swimmer]);

  const changed = () => setChanges((n) => n + 1);
  const passCount = mine?.filter((b) => b.status === "confirmed").length ?? 0;
  const showTab = (next: typeof tab, pass: number | null = null) => {
    setOpenPass(pass);
    setTab(next);
  };

  return (
    <>
      <PoolFloor />
      <div className="demo">
        <div className="in">
          <span>Demo: there's no sign-in, so pick any swimmer.</span>
          <label>
            You're{" "}
            <select value={swimmer} onChange={(e) => { setSwimmer(e.target.value); setOpenPass(null); }} aria-label="Swimmer">
              {SWIMMERS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      <PoolHeader />

      <div className="toolbar">
        <div className="in">
          <div className="seg" role="group" aria-label="Theme">
            {THEMES.map(([value, label]) => (
              <button key={value} aria-pressed={settings.theme === value} onClick={() => settings.setTheme(value)}>{label}</button>
            ))}
          </div>
          <button className="tool" aria-pressed={settings.paused} onClick={() => settings.setPaused(!settings.paused)}>
            {settings.paused ? "Play water" : "Pause water"}
          </button>
        </div>
      </div>

      <main className="app">
        <section className="panel" aria-labelledby="app-title">
          <div className="panel-head">
            <div className="brand">
              <h1 id="app-title" className="t wordmark">SwimSync</h1>
              <div className="tabs" role="tablist" aria-label="Swimmer views">
                <button role="tab" aria-selected={tab === "sessions"} onClick={() => showTab("sessions")}>Sessions</button>
                <button role="tab" aria-selected={tab === "bookings"} onClick={() => showTab("bookings")}>
                  Your bookings<span className="count">{passCount}</span>
                </button>
              </div>
            </div>
            {tab === "sessions" ? <SessionsHead sessions={sessions} asOf={asOf} stale={stale} /> : <BookingsHead mine={mine} swimmer={swimmer} />}
          </div>
          <div className="panel-body" role="tabpanel">
            {tab === "sessions" ? (
              <SessionsPage sessions={sessions} mine={mine} swimmer={swimmer} onChanged={changed} onShowPass={(id) => showTab("bookings", id)} />
            ) : (
              <MyBookingsPage mine={mine} notices={notices} swimmer={swimmer} openPass={openPass} onChanged={changed} onSeeSessions={() => showTab("sessions")} />
            )}
          </div>
        </section>
      </main>
    </>
  );
}
