import { useEffect, useRef } from "react";

import { createPoolHeader } from "../pool/header";
import { settings } from "../settings";

/** The pool band at the top of the page. Decorative, so screen readers skip it. */
export function PoolHeader() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const scene = createPoolHeader(canvas.current!);
    const unsubscribe = settings.subscribe(scene.update); // theme, Pause water, tab hidden, reduced motion
    return () => {
      unsubscribe();
      scene.destroy();
    };
  }, []);

  return (
    <div className="hero" aria-hidden="true">
      <canvas ref={canvas} className="water" />
    </div>
  );
}
