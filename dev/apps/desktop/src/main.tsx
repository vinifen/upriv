import React from "react";
import ReactDOM from "react-dom/client";
import App from "./RootApp";
import { AppErrorBoundary } from "@/components/system/AppErrorBoundary";
import "@/styles/globals.css";
import { applyDocumentTheme } from "@/theme";

applyDocumentTheme();

function endLaunchFocus(): void {
  document.documentElement.removeAttribute("data-launch-focus");
  window.removeEventListener("keydown", endLaunchFocus, true);
  window.removeEventListener("pointerdown", endLaunchFocus, true);
  document.removeEventListener("focusin", blurLaunchMenuFocus, true);
}

function blurLaunchMenuFocus(event: FocusEvent): void {
  if (!document.documentElement.hasAttribute("data-launch-focus")) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.getAttribute("aria-haspopup") === "menu") {
    target.blur();
  }
}

window.addEventListener("keydown", endLaunchFocus, true);
window.addEventListener("pointerdown", endLaunchFocus, true);
document.addEventListener("focusin", blurLaunchMenuFocus, true);

// Theme updates from AppSettingsProvider (`useLayoutEffect`).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
