import { useState, type FormEvent } from "react";

import { operatorApi } from "../api";
import { PoolFloor } from "../components/PoolFloor";
import { Toolbar } from "../components/Toolbar";
import { clock, hhmm } from "../time";
import { ChangeLog } from "./ChangeLog";
import { SessionPanel } from "./SessionPanel";
import { useOperatorData } from "./useOperatorData";

// The token is typed in on this screen and kept in sessionStorage: this tab only, and gone when the
// tab closes (ADR-017). It's never put in the URL or in localStorage.
const SLOT = "swimsync.operator-token";
const tokenStore = {
  load() {
    try {
      return sessionStorage.getItem(SLOT);
    } catch {
      return null;
    }
  },
  save(token: string) {
    try {
      sessionStorage.setItem(SLOT, token);
    } catch {
      // private browsing: it's asked for again after a reload
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(SLOT);
    } catch {
      // nothing was stored
    }
  },
};

/** The operator's screen at /operator: sign in with the token, then manage the sessions. */
export function OperatorApp() {
  const [token, setToken] = useState(tokenStore.load);
  const [notice, setNotice] = useState("");

  const signIn = (next: string) => {
    tokenStore.save(next);
    setNotice("");
    setToken(next);
  };
  const signOut = (why: string) => {
    tokenStore.clear();
    setNotice(why);
    setToken(null);
  };

  return (
    <div className="op">
      <PoolFloor />
      <div className="demo">
        <div className="in">
          <span>Demo: one shared operator token stands in for real staff sign-in. <a href="/">Swimmer screen</a></span>
        </div>
      </div>
      <Toolbar />
      {token ? (
        <Desk token={token} onSignOut={() => signOut("")} onRefused={() => signOut("That token is no longer accepted. Sign in again.")} />
      ) : (
        <SignIn notice={notice} onSignedIn={signIn} />
      )}
    </div>
  );
}

function SignIn({ notice, onSignedIn }: { notice: string; onSignedIn: (token: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return setError("Enter the operator token.");
    setBusy(true);
    const answer = await operatorApi.changeLog(token); // a read, so checking the token changes nothing
    setBusy(false);
    if (answer.status === 200) onSignedIn(token);
    else if (answer.status === 403) setError("That token wasn't accepted. Check it and try again.");
    else setError("Couldn't reach the booking server to check the token. Try again in a moment.");
  }

  return (
    <main className="app">
      <section className="panel" aria-labelledby="signin-title">
        <div className="panel-head">
          <div className="brand">
            <h1 className="t wordmark">SwimSync</h1>
          </div>
          <div className="op-head op-intro">
            <div>
              <h2 id="signin-title">Operator sign-in</h2>
              <p className="sub">Enter the operator token set on the server. It's kept in this tab only and forgotten when the tab closes.</p>
            </div>
          </div>
        </div>
        <form className="panel-body" onSubmit={submit}>
          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="op-token">Operator token</label>
            <input id="op-token" className="box" type="password" autoComplete="off" value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} />
            <span className="error" role="alert">{error}</span>
          </div>
          <div className="btn-row">
            <button className="btn" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function Desk({ token, onSignOut, onRefused }: { token: string; onSignOut: () => void; onRefused: () => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  // Bumped after any change, so everything is read again straight away.
  const [changes, setChanges] = useState(0);
  const [first, setFirst] = useState<number | null>(null);
  const selected = chosen ?? first;
  const { sessions, places, log, asOf, stale } = useOperatorData(token, selected, changes, onRefused);

  // Until the operator picks one, show the first session.
  if (first === null && sessions?.length) setFirst(sessions[0].id);
  const session = sessions?.find((s) => s.id === selected);
  const label = asOf ? (stale ? `Couldn't refresh. As of ${clock(asOf)}` : `As of ${clock(asOf)}`) : stale ? "Can't reach the booking server." : "Loading…";

  return (
    <main className="op-main">
      <section className="panel" aria-labelledby="sessions-title">
        <div className="panel-head">
          <div className="brand">
            <h1 className="t wordmark">SwimSync</h1>
            <button className="tool" onClick={onSignOut}>Sign out</button>
          </div>
          <div className="dayrow">
            <h2 id="sessions-title" className="t day">Operator</h2>
            <span className={`asof${stale ? " stale" : ""}`}>{label}</span>
          </div>
          <p className="hint">Pick a session to see who's booked, change its capacity or close it.</p>
        </div>
        <div className="panel-body">
          {sessions === null ? (
            <p className="empty">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className="empty">No sessions yet.</p>
          ) : (
            <div className="list">
              {sessions.map((s) => (
                <button key={s.id} className={`session op-pick${s.status === "closed" ? " closed" : ""}`} aria-pressed={s.id === selected} onClick={() => setChosen(s.id)}>
                  <span className="s-top">
                    <span className="t time">{hhmm(s.starts_at)}</span>
                    <span className="s-name">{s.name}</span>
                  </span>
                  <span className="sub">{s.status === "closed" ? "Closed" : `${s.capacity - s.remaining} booked of ${s.capacity}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {session ? (
        <SessionPanel
          key={session.id}
          session={session}
          places={places?.session_id === session.id ? places : null}
          token={token}
          bringIntoView={chosen !== null}
          onChanged={() => setChanges((n) => n + 1)}
          onRefused={onRefused}
        />
      ) : (
        <section className="panel op-panel">
          <p className="empty">{sessions === null ? "Loading…" : "Pick a session."}</p>
        </section>
      )}

      <ChangeLog log={log} />
    </main>
  );
}
