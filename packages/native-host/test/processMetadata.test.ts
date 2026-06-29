import { describe, expect, it } from "vitest";
import { readProcessMetadata } from "../src/processMetadata";

describe("readProcessMetadata", () => {
  it("includes resource counters for the current process", async () => {
    const metadata = await readProcessMetadata([process.pid]);
    const current = metadata.get(process.pid);

    expect(current?.resources).toMatchObject({
      memoryBytes: expect.any(Number),
      uptimeMs: expect.any(Number)
    });
    if (process.platform === "win32") {
      expect(current?.resources).toMatchObject({
        privateMemoryBytes: expect.any(Number),
        handleCount: expect.any(Number)
      });
    }
    if (process.platform !== "darwin") {
      expect(current?.resources).toMatchObject({
        threadCount: expect.any(Number)
      });
    }
    expect(current?.resources?.memoryBytes).toBeGreaterThan(0);
    if (current?.resources?.threadCount !== undefined) {
      expect(current.resources.threadCount).toBeGreaterThan(0);
    }
  });
});
