import { describe, expect, it } from "vitest";
import { isLocalishListener, parseNetstatListeners } from "../src/netstat";

describe("parseNetstatListeners", () => {
  it("parses IPv4, wildcard, and IPv6 listening rows", () => {
    const output = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       6600
  TCP    0.0.0.0:8788           0.0.0.0:0              LISTENING       56620
  TCP    [::1]:8658             [::]:0                 LISTENING       56000
  TCP    [::]:8990              [::]:0                 LISTENING       52620
`;

    expect(parseNetstatListeners(output)).toEqual([
      { address: "127.0.0.1", port: 5173, pid: 6600 },
      { address: "0.0.0.0", port: 8788, pid: 56620 },
      { address: "::1", port: 8658, pid: 56000 },
      { address: "::", port: 8990, pid: 52620 }
    ]);
  });
});

describe("isLocalishListener", () => {
  it("keeps loopback and wildcard listeners but excludes specific LAN-bound addresses", () => {
    expect(isLocalishListener({ address: "127.0.0.1", port: 5173, pid: 100 })).toBe(true);
    expect(isLocalishListener({ address: "::1", port: 5173, pid: 100 })).toBe(true);
    expect(isLocalishListener({ address: "0.0.0.0", port: 5173, pid: 100 })).toBe(true);
    expect(isLocalishListener({ address: "::", port: 5173, pid: 100 })).toBe(true);
    expect(isLocalishListener({ address: "192.168.1.20", port: 5173, pid: 100 })).toBe(false);
    expect(isLocalishListener({ address: "10.10.50.10", port: 5173, pid: 100 })).toBe(false);
    expect(isLocalishListener({ address: "fe80::abcd", port: 5173, pid: 100 })).toBe(false);
  });
});
