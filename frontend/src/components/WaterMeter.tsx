/** A small tank that fills with water as places are booked. */
export function WaterMeter({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
  return (
    <div
      role="img"
      aria-label={`${booked} of ${capacity} places booked`}
      className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-white"
    >
      <div className="absolute inset-x-0 bottom-0 bg-water transition-[height] duration-700 ease-out" style={{ height: `${pct}%` }} />
      <div className="absolute inset-x-0 top-1 text-center text-[11px] font-medium text-slate-700 mix-blend-multiply">{pct}%</div>
    </div>
  );
}

/** How busy a session is. Labels describe the real fill level, never invented urgency. */
export function CrowdChip({ booked, capacity }: { booked: number; capacity: number }) {
  const fill = capacity > 0 ? booked / capacity : 1;
  const [label, style] =
    fill >= 1
      ? ["Full", "bg-rose-100 text-rose-800"]
      : fill >= 0.7
        ? ["Busy", "bg-amber-100 text-amber-800"]
        : fill >= 0.4
          ? ["Moderate", "bg-sky-100 text-sky-800"]
          : ["Quiet", "bg-emerald-100 text-emerald-800"];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
