import { describe, expect, it } from "vitest";
import { readProcessMetadata } from "../src/processMetadata";

describe("readProcessMetadata", () => {
  it("includes resource counters for the current process", async () => {
    const metadata = await readProcessMetadata([process.pid]);
    const current = metadata.get(process.pid);

    expect(current?.resources).toMatchObject({
      memoryBytes: expect.any(Number),
      privateMemoryBytes: expect.any(Number),
      threadCount: expect.any(Number),
      handleCount: expect.any(Number),
      uptimeMs: expect.any(Number)
    });
    expect(current?.resources?.memoryBytes).toBeGreaterThan(0);
    expect(current?.resources?.threadCount).toBeGreaterThan(0);
  });
});
