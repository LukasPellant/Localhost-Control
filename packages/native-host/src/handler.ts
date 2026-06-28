import { isHostRequest, type HostError, type HostRequest } from "@localhost-control/shared";
import { killProcessTree, openTerminal } from "./actions.js";
import { scanLocalPorts } from "./scanner.js";

export const handleRequest = async (request: unknown): Promise<unknown | HostError> => {
  if (!isHostRequest(request)) {
    return { error: "invalid_request", message: "Request does not match the Localhost Control native host protocol." };
  }

  switch (request.method) {
    case "scan":
      return scanLocalPorts(request.params);
    case "kill":
      return killProcessTree(request.params);
    case "openTerminal":
      return openTerminal(request.params);
    case "version":
      return { version: "0.1.2", platform: process.platform };
  }
};

export const handleRequestEnvelope = async (request: HostRequest | unknown): Promise<unknown> => {
  const id = typeof request === "object" && request && "id" in request ? request.id : undefined;
  const result = await handleRequest(request);
  return { id, result };
};
