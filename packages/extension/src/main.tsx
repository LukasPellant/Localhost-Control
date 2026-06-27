import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createMockHostClient, createNativeHostClient, shouldUseMockClient } from "./lib/hostClient";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App client={shouldUseMockClient() ? createMockHostClient() : createNativeHostClient()} />
  </React.StrictMode>
);
