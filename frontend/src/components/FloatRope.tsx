import type { Float } from "../rope";

const CLASS: Record<Float["kind"], string> = { free: "b", booked: "b on", yours: "b you", checking: "b chk" };

/** A session's places as floats on a lane rope, ending at the wall. Decorative: the text says the same. */
export function FloatRope({ floats }: { floats: Float[] }) {
  return (
    <div className="rope" aria-hidden="true">
      {floats.map((f, i) => (
        <span key={i} className={`${CLASS[f.kind]}${f.last && f.kind !== "yours" && f.kind !== "checking" ? " red" : ""}`} />
      ))}
      <span className="wall" />
    </div>
  );
}

/** What the floats mean, shown once above the list. */
export function RopeLegend() {
  return (
    <div className="legend" aria-label="What the floats mean">
      <span><i className="b on" />Booked</span>
      <span><i className="b" />Free</span>
      <span><i className="b you" />Yours</span>
      <span><i className="b chk" />Checking</span>
      <span><i className="b red" />Last places</span>
    </div>
  );
}
