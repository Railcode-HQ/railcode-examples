import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { loadRailcodeSdk } from "./lib/load-sdk";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

loadRailcodeSdk()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(
      <div className="sdk-error">
        <div className="card">
          <h1>Railcode SDK unavailable</h1>
          <p>
            {error instanceof Error
              ? error.message
              : "Could not load /_api/sdk.js."}
          </p>
        </div>
      </div>,
    );
  });
