import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createNativeHostClient, shouldUseMockClient, type HostClient } from "./lib/hostClient";
import { createMockHostClient } from "./lib/mockHostClient";

const client: HostClient = import.meta.env.DEV && shouldUseMockClient(true) ? createMockHostClient() : createNativeHostClient();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App client={client} />
  </React.StrictMode>
);
