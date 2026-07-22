import React from "react";
import ReactDOM from "react-dom/client";
import App from "./RootApp";
import "@/styles/globals.css";

// Theme is applied once by AppSettingsProvider (single source: mock settings state).
// StrictMode double-mounts in dev — hooks must be idempotent (vault-lifecycle/useVaultPipelineRun).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
