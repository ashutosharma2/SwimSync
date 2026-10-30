import { useSettings, type Theme } from "../settings";

const THEMES: [Theme, string][] = [["device", "Match device"], ["light", "Light"], ["dark", "Night pool"]];

/** The bar under the header on both screens: the theme, and Pause water. */
export function Toolbar() {
  const settings = useSettings();
  return (
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
  );
}
