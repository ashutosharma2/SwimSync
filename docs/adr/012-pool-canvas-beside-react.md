# ADR-012: Draw the pool in plain TypeScript beside React

- Status: Accepted
- Date: 2026-10-29

## Scenario

The swimmer screen carries the pool from the demo. A header shows swimmers, spray and touch ripples. A pool floor sits behind the cards, and its bubbles and ripples answer the app: bubbles when a booking is confirmed, a ripple when an operator changes capacity. In [prototype/index.html](../../prototype/index.html) this is about 680 lines of canvas code. Each scene runs its own frame loop and stops when the viewer pauses the water, hides the tab, asks for reduced motion or scrolls the header away.

## Obstacle

- The scenes redraw up to 60 times a second. React decides what to render from state, so sending every frame through React state would re-render components for pixels React never sees.
- The scenes and the components share settings (the theme and Pause water), and the floor has to hear about events from cards deep in the component tree.
- In development, React's StrictMode mounts each effect twice. A scene has to start and stop cleanly, with no frame loop or listener left running.

## Action

- The drawing code lives in [src/pool/](../../frontend/src/pool/) as plain TypeScript with no React imports: `draw.ts` (shared helpers and the caustics tile), `header.ts` and `floor.ts`. Each scene module exports a `create...` function that takes a canvas and returns `update()` and `destroy()`. The code is a close port of the demo, so the demo stays the reference.
- [PoolHeader.tsx](../../frontend/src/components/PoolHeader.tsx) and [PoolFloor.tsx](../../frontend/src/components/PoolFloor.tsx) are thin wrappers. On mount they create the scene and subscribe it to the settings. On unmount they unsubscribe and destroy it.
- [settings.ts](../../frontend/src/settings.ts) keeps the theme and Pause water in a small store outside React. Components read it through `useSyncExternalStore`, the scenes subscribe to it, and `waterMoves()` is the one rule for when water may move.
- Cards reach the floor through `bubblesBeside()` and `ringFrom()` in `floor.ts`. Both do nothing while the water is still or when no floor is on the page.

Alternatives considered:

- **Draw from React state.** Swimmer positions in state, one render per frame. Every frame would re-render components, and the scenes' clock-based maths would be split across hooks.
- **A canvas library.** A new dependency to learn and keep up to date, for flat 2D shapes the canvas API already draws.
- **Load the demo's script as it is.** No types, global variables, and no clean way to start and stop it with the component that shows it.

## Result

- The React side of the pool is two wrappers of about 25 lines each.
- The frontend checks pass: typecheck, 21 tests (the 16 booking tests and 5 new ones for the float rope in [rope.ts](../../frontend/src/rope.ts)), and the production build.
- Trade-offs: the canvas code has no tests of its own. The scenes read their colours from CSS variables, so every theme change has to reach `update()`, which the settings subscription does. `bubblesBeside()` and `ringFrom()` talk to the one floor on the page.
- Follow-up: check the screen in a browser against the real API, at phone width and wide, in both themes. That hasn't been done yet.

## Troubleshooting

- **The floor's type referred to itself.** `floor.ts` keeps the floor that's showing in a module variable, first typed from the create function's own return type. TypeScript can't infer a type that depends on itself. Spotted while writing the module, before the first typecheck, and fixed with an explicit `Floor` interface. Lesson: a module-level reference to an instance needs a declared type.
