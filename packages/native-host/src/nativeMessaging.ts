const HEADER_BYTES = 4;
const MAX_CHROME_RESPONSE_BYTES = 1024 * 1024;

const responseId = (message: unknown): string | undefined =>
  typeof message === "object" && message !== null && "id" in message && typeof message.id === "string" ? message.id : undefined;

const encodeBody = (message: unknown): Buffer => Buffer.from(JSON.stringify(message), "utf8");

const oversizedResponse = (id: string | undefined): unknown => ({
  ...(id ? { id } : {}),
  result: {
    error: "response_too_large",
    message: "Native host response exceeded Chrome's 1 MB message limit."
  }
});

export const encodeNativeMessage = (message: unknown): Buffer => {
  let body = encodeBody(message);
  if (body.byteLength > MAX_CHROME_RESPONSE_BYTES) {
    body = encodeBody(oversizedResponse(responseId(message)));
  }

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(body.byteLength, 0);
  return Buffer.concat([header, body]);
};

export type MessageParser = {
  push(chunk: Buffer): unknown[];
};

export const createMessageParser = (): MessageParser => {
  let buffer = Buffer.alloc(0);

  return {
    push(chunk: Buffer): unknown[] {
      buffer = Buffer.concat([buffer, chunk]);
      const messages: unknown[] = [];

      while (buffer.byteLength >= HEADER_BYTES) {
        const messageLength = buffer.readUInt32LE(0);
        const frameLength = HEADER_BYTES + messageLength;
        if (buffer.byteLength < frameLength) break;

        const payload = buffer.subarray(HEADER_BYTES, frameLength).toString("utf8");
        buffer = buffer.subarray(frameLength);

        try {
          messages.push(JSON.parse(payload));
        } catch {
          messages.push({
            error: "invalid_json",
            message: "Native messaging payload was not valid JSON."
          });
        }
      }

      return messages;
    }
  };
};
