import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { configureLogger } from "./shared/lib/logger";
import { startupTheme } from "./shared/platform/theme";

// Paint the saved theme — or the OS appearance on first launch — before the
// first render, so the app never flashes the wrong theme while it boots.
document.documentElement.dataset.theme = startupTheme();
configureLogger({ minimumLevel: "info" });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
