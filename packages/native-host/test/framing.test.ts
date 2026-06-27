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
});
