const HEADER_BYTES = 4;

export const encodeNativeMessage = (message: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
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
        messages.push(JSON.parse(payload));
        buffer = buffer.subarray(frameLength);
      }

      return messages;
    }
  };
};
