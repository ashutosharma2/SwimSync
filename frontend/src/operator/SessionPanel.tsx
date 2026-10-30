import { useEffect, useRef, useState } from "react";

import { operatorApi, type Answer, type Session, type SessionPlaces } from "../api";
import { ringFrom } from "../pool/floor";
import { clock, hhmm } from "../time";
import { afterUnknown, cutPreview, plural, resultLine, writeOutcome, type Change, type ResultLine } from "./cut";
import { operatorRope } from "./rope";

/**
 * The chosen session: its bookings on the rope in the order they were made, and the controls to change
 * its capacity or close it. The slider only previews; nothing is sent until the operator applies it
 * with a reason.
 */
export function SessionPanel({ session, places, token, bringIntoView, onChanged, onRefused }: {
  session: Session;
  places: SessionPlaces | null;
  token: string;
  bringIntoView: boolean;
  onChanged: () => void;
  onRefused: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const reasonBox = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<number | null>(null); // null: the current capacity
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResultLine | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // On a phone the panel is under the list, so a session the operator picked is brought into view
  // once its bookings have loaded (before that the page may be too short to scroll that far).
  const loaded = places !== null;
  useEffect(() => {
    if (loaded && bringIntoView && matchMedia("(max-width: 1023px)").matches) panel.current?.scrollIntoView({ block: "start" });
  }, [loaded, bringIntoView]);

  if (!places) {
    return (
      <section className="panel op-panel">
        <p className="empty">Loading who's booked…</p>
      </section>
    );
  }

  const closed = places.status === "closed";
  const goal = target ?? places.capacity;
  const preview = cutPreview(places.bookings, places.capacity, goal);
  const pickedAt = places.bookings.findIndex((p) => p.booking_id === picked);
  const pickedPlace = pickedAt >= 0 ? places.bookings[pickedAt] : null;

  async function send(change: Change, write: () => Promise<Answer>) {
    setBusy(true);
    setError("");
    setResult({ text: change.kind === "capacity" ? "Saving…" : "Closing…", bad: false, done: false });
    const outcome = writeOutcome(await write());
    if (outcome.kind === "refused") return onRefused();
    let line = resultLine(change, outcome);
    if (outcome.kind === "unknown") {
      setResult(line);
      line = afterUnknown(change, await operatorApi.places(session.id, token));
    }
    setResult(line);
    setBusy(false);
    if (line.done) {
      setTarget(null);
      setReason("");
      ringFrom(panel.current); // the pool answers only once the change is known to have happened
    }
    onChanged();
  }

  function needReason(text: string) {
    if (reason.trim()) return false;
    setError(text);
    reasonBox.current?.focus();
    return true;
  }

  function apply() {
    if (!preview.changes) return setError("Choose a different capacity first.");
    if (needReason("Enter a reason. It goes in the change log.")) return;
    send({ kind: "capacity", name: places!.name, target: goal }, () => operatorApi.setCapacity(session.id, goal, reason.trim(), token));
  }

  function askClose() {
    if (needReason("Enter a reason before closing. It goes in the change log.")) return;
    setError("");
    setConfirmClose(true);
  }

  function close() {
    setConfirmClose(false);
    send({ kind: "close", name: places!.name }, () => operatorApi.close(session.id, reason.trim(), token));
  }

  const booked = places.bookings.length;
  return (
    <section className="panel op-panel" ref={panel} aria-labelledby="op-title">
      <div className="panel-head">
        <div className="op-session">
          <span className="t">{hhmm(session.starts_at)}</span>
          <div>
            <h2 id="op-title"><b>{places.name}</b></h2>
            <span className="sub">{closed ? "Closed" : `${places.booked} booked of ${places.capacity} places`}</span>
          </div>
        </div>
        {!closed && (
          <>
            <div className="rope" role="group" aria-label="Bookings in the order they were made" style={{ height: 30, marginTop: 14 }}>
              {operatorRope(places.bookings, goal).map((f, i) =>
                f.kind === "wall" ? (
                  <span key={`wall-${i}`} className="wall" />
                ) : f.kind === "free" ? (
                  <span key={`free-${i}`} className={`b${f.last ? " red" : ""}`} aria-hidden="true" />
                ) : (
                  <button
                    key={f.place.booking_id}
                    className={`b ${f.lose ? "lose" : `on${f.last ? " red" : ""}`}${picked === f.place.booking_id ? " picked" : ""}`}
                    aria-pressed={picked === f.place.booking_id}
                    aria-label={`${f.place.swimmer_id}, booked at ${hhmm(f.place.booked_at)}${f.lose ? ", loses their place in this change" : ""}`}
                    onClick={() => setPicked(f.place.booking_id)}
                  />
                ),
              )}
            </div>
            <div className="axis"><span>Booked first</span><span>Booked last</span></div>
            <p className="picked-line" aria-live="polite">
              {pickedPlace
                ? `${pickedPlace.swimmer_id}, booked at ${clock(new Date(pickedPlace.booked_at))} (booking ${pickedPlace.booking_id}).${pickedAt >= goal ? " Loses their place in this change." : ""}`
                : "Tap a float to see who booked it."}
            </p>
          </>
        )}
      </div>

      <div className="panel-body">
        {closed ? (
          <p className="result">This session is closed. A closed session takes no bookings and can't be changed.</p>
        ) : (
          <>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="op-slider">New capacity</label>
              <div className="slider-row">
                <input
                  id="op-slider"
                  type="range"
                  min={1}
                  max={Math.max(40, places.capacity)}
                  step={1}
                  value={goal}
                  onChange={(e) => {
                    setTarget(Number(e.target.value));
                    setError("");
                    setResult(null);
                    setConfirmClose(false);
                  }}
                />
                <span className="t readout">{goal}</span>
              </div>
            </div>
            <p className="preview" aria-live="polite">{preview.line}</p>
            <div className="field">
              <label htmlFor="op-reason">Reason, for the change log</label>
              <input
                ref={reasonBox}
                className="box"
                id="op-reason"
                type="text"
                maxLength={200}
                placeholder="One lifeguard off sick"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError("");
                }}
              />
              <span className="error">{error}</span>
            </div>
            <div className="btn-row">
              <button className="btn" disabled={busy} onClick={apply}>{preview.label}</button>
              <button className="btn danger" disabled={busy} onClick={askClose}>Close session</button>
            </div>
            {confirmClose && (
              <div className="confirm">
                <p>{booked ? `Close ${places.name} and cancel all ${plural(booked, "booking", "bookings")}? Each swimmer gets a notice.` : `Close ${places.name}? Nobody is booked.`}</p>
                <div className="btn-row">
                  <button className="btn danger" onClick={close}>Close session</button>
                  <button className="btn ghost" autoFocus onClick={() => setConfirmClose(false)}>Keep it open</button>
                </div>
              </div>
            )}
          </>
        )}
        <div aria-live="polite">{result && <p className={`result${result.bad ? " bad" : ""}`}>{result.text}</p>}</div>
      </div>
    </section>
  );
}
