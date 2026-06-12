import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/reviewAllocation.css";
import "./styles/allocationReport.css";
import "./styles/transitApproval.css";
import "./styles/allocationOverride.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
