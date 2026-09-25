import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { runs, statusStore } from "./api";
import { sessions, youtube } from "./hub";
import "@fontsource/barlow-condensed/300.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";

async function boot() {
  // Browser-only design preview; the real app always has the Tauri bridge.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./dev/mock");
  await runs.init();
  await sessions.init();
  statusStore.init();
  youtube.start();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
