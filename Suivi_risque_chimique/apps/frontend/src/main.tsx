import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./lib/i18n";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Élément #root introuvable dans index.html");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
