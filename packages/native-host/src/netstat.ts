import { isLocalishListener } from "./platform/common.js";
import { readTcpListeners } from "./platform/index.js";
import type { Listener } from "./platform/types.js";
import { parseNetstatListeners } from "./platform/windows/netstat.js";

export type { Listener };
export { isLocalishListener, parseNetstatListeners, readTcpListeners };

export const isPortListening = async (port: number): Promise<boolean> => {
  const listeners = await readTcpListeners();
  return listeners.some((listener) => listener.port === port);
};
