export function loadRailcodeSdk(): Promise<void> {
  if ("me" in window && "db" in window) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-railcode-sdk="true"]',
  );
  if (existing) {
    return waitForScript(existing);
  }

  const script = document.createElement("script");
  script.src = "/_api/sdk.js";
  script.async = false;
  script.dataset.railcodeSdk = "true";
  document.head.appendChild(script);
  return waitForScript(script);
}

function waitForScript(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if ("me" in window && "db" in window) {
      resolve();
      return;
    }

    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Could not load /_api/sdk.js.")),
      { once: true },
    );
  });
}
