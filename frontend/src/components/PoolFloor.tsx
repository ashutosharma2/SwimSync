import { useEffect, useRef } from "react";

import { createPoolFloor } from "../pool/floor";
import { settings } from "../settings";

/** The pool floor fixed behind the page. Decorative, so screen readers skip it. */
export function PoolFloor() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const scene = createPoolFloor(canvas.current!);
    const unsubscribe = settings.subscribe(scene.update);
    return () => {
      unsubscribe();
      scene.destroy();
    };
  }, []);

  return <canvas ref={canvas} className="pool-floor" aria-hidden="true" />;
}
