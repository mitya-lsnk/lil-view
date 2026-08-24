import React from "react";
import ReactDOM from "react-dom/client";

import "./theme.css";
import App from "./App";
import { LangProvider } from "./lib/i18n";
import { SkinProvider } from "./lib/skin";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LangProvider>
      <SkinProvider>
        <App />
      </SkinProvider>
    </LangProvider>
  </React.StrictMode>,
);
