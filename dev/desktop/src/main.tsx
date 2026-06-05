import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getMockAppSettings } from "@/features/app-settings/mockAppSettings";
import { applyDocumentTheme } from "@/theme";
import "@/styles/globals.css";

applyDocumentTheme(getMockAppSettings().ui.theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
