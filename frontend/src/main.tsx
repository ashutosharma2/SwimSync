import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./index.css";
import { OperatorApp } from "./operator/OperatorApp";
import { applyTheme } from "./settings";

applyTheme(); // before the first paint, so the page doesn't flash the wrong theme

// Two screens, so a path check instead of a router. nginx and Vite both serve index.html for /operator.
const operator = location.pathname.replace(/\/+$/, "") === "/operator";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {operator ? <OperatorApp /> : <App />}
  </StrictMode>,
);
