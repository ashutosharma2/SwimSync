# ADR-013: Port the demo's CSS instead of rewriting it in Tailwind

- Status: Accepted
- Date: 2026-10-29

## Scenario

The design was worked out in the demo, [prototype/index.html](../../prototype/index.html): colours for light and night pool, a six-step type scale, the float rope and the timetable-style session cards. The React app had an older look, written as Tailwind utility classes in each component.

## Obstacle

- Two copies of one design drift apart. Rewriting about 150 lines of CSS as utility classes across the components is a full translation, with room for small differences on the way.
- The canvas scenes read their colours from CSS variables (`--pool-*`, see [ADR-012](012-pool-canvas-beside-react.md)), so those colours have to live in CSS whichever way the components are styled.

## Action

Ashu chose (2026-10-29) to port the demo's CSS. [index.css](../../frontend/src/index.css) holds the demo's variables and the classes the swimmer screen uses, and the components use the demo's class names. Tailwind stays only for its base reset. The operator screen's classes will come with that screen.

Alternatives considered:

- **Rewrite it in Tailwind,** with the colours and sizes in `@theme`. Closer to how the frontend was written before, but a full translation of the demo's styles, and every later design fix would need making twice.

## Result

- A class in a component can be traced straight back to the demo. No Tailwind utility classes are left in the components.
- The built stylesheet is 16.45 kB, 4.63 kB gzipped.
- Trade-off: when the demo's design changes, the change has to be copied into `index.css` by hand.

## Troubleshooting

None.
