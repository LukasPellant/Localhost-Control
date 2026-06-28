import { killProcessTree, openTerminal } from "./actions.js";
import { readTcpListeners } from "./netstat.js";
import { readProcessMetadata } from "./processMetadata.js";
import type { PlatformAdapter } from "../types.js";

export const darwinAdapter: PlatformAdapter = {
  readTcpListeners,
  readProcessMetadata,
  killProcessTree,
  openTerminal
};
