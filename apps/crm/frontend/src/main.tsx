import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

// No SDK to load. On apps v2 the frontend is static files with no credentials
// and no platform access; everything goes through the worker's /api/rc/* routes
// (see lib/railcode.ts), so the app can render immediately.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
