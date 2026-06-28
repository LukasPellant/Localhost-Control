import { describe, expect, it } from "vitest";
import { createMessageParser, encodeNativeMessage } from "../src/nativeMessaging";

describe("native messaging framing", () => {
  it("encodes and decodes length-prefixed JSON messages across arbitrary chunks", () => {
    const encoded = encodeNativeMessage({ id: "1", method: "version" });
    const parser = createMessageParser();

    expect(parser.push(encoded.subarray(0, 2))).toEqual([]);
    expect(parser.push(encoded.subarray(2, 7))).toEqual([]);
    expect(parser.push(encoded.subarray(7))).toEqual([{ id: "1", method: "version" }]);
  });

  it("returns an invalid JSON error instead of throwing on malformed frames", () => {
    const payload = Buffer.from("{", "utf8");
    const frame = Buffer.alloc(4 + payload.byteLength);
    frame.writeUInt32LE(payload.byteLength, 0);
    payload.copy(frame, 4);

    const parser = createMessageParser();

    expect(parser.push(frame)).toEqual([
      {
        error: "invalid_json",
        message: "Native messaging payload was not valid JSON."
      }
    ]);
  });

  it("encodes an explicit error instead of writing an oversized Chrome response", () => {
    const encoded = encodeNativeMessage({
      id: "huge-scan",
      result: {
        entries: [{ commandLine: "x".repeat(1024 * 1024 + 1) }]
      }
    });
    const parser = createMessageParser();

    expect(encoded.byteLength).toBeLessThanOrEqual(1024 * 1024 + 4);
    expect(parser.push(encoded)).toEqual([
      {
        id: "huge-scan",
        result: {
          error: "response_too_large",
          message: "Native host response exceeded Chrome's 1 MB message limit."
        }
      }
    ]);
  });
});
