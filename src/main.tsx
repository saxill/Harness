import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { runs, statusStore } from "./api";
import "./styles.css";

async function boot() {
  // Browser-only design preview; the real app always has the Tauri bridge.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./dev/mock");
  await runs.init();
  statusStore.init();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
