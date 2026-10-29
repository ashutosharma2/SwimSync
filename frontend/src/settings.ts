// The viewer's display settings (theme, Pause water) and when the pool's water may move.
// A tiny store outside React, so the canvas scenes and the components read the same values.

import { useSyncExternalStore } from "react";

export type Theme = "device" | "light" | "dark";

const KEY = "swimsync.";
function load(name: string, fallback: string) {
  try {
    return localStorage.getItem(KEY + name) ?? fallback;
  } catch {
    return fallback; // private browsing: the choice just isn't remembered
  }
}
function save(name: string, value: string) {
  try {
    localStorage.setItem(KEY + name, value);
  } catch {
    // private browsing
  }
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<() => void>();
let theme = load("theme", "device") as Theme;
let paused = load("water", "on") === "off";
let version = 0; // changes whenever anything here does, for useSyncExternalStore

function changed() {
  version++;
  listeners.forEach((fn) => fn());
}

/** Puts the chosen theme on <html data-theme>, which the CSS colours follow. */
export function applyTheme() {
  const dark = theme === "dark" || (theme === "device" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export const settings = {
  get theme() {
    return theme;
  },
  setTheme(next: Theme) {
    theme = next;
    save("theme", next);
    applyTheme();
    changed();
  },
  get paused() {
    return paused;
  },
  setPaused(next: boolean) {
    paused = next;
    save("water", next ? "off" : "on");
    changed();
  },
  /** Water moves only when the viewer hasn't paused it, hasn't asked for reduced motion, and can see the tab. */
  waterMoves() {
    return !paused && !reducedMotion.matches && !document.hidden;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

darkQuery.addEventListener("change", () => {
  if (theme === "device") {
    applyTheme();
    changed();
  }
});
reducedMotion.addEventListener("change", changed);
document.addEventListener("visibilitychange", changed);

/** Re-renders a component when any setting changes. */
export function useSettings() {
  useSyncExternalStore(settings.subscribe, () => version);
  return settings;
}
