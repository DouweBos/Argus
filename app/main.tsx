import React from "react";
import ReactDOM from "react-dom/client";
import { vscodeReady } from "./lib/vscodeSetup";
import App from "./App";

// VS Code services must be initialized before any editor component renders
vscodeReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
