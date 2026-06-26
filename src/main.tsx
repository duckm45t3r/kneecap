import "./vhs-tokens.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initThemeBeforePaint } from "./theme";

// Apply the saved ink/paper theme synchronously BEFORE React renders so the
// correct surface is in place at first paint — avoids a flash-of-wrong-theme.
initThemeBeforePaint();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
