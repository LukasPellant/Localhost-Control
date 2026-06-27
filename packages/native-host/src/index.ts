#!/usr/bin/env node
import { createMessageParser, encodeNativeMessage } from "./nativeMessaging.js";
import { handleRequestEnvelope } from "./handler.js";

const parser = createMessageParser();

process.stdin.on("data", (chunk: Buffer) => {
  void Promise.all(
    parser.push(chunk).map(async (message) => {
      try {
        process.stdout.write(encodeNativeMessage(await handleRequestEnvelope(message)));
      } catch (error) {
        const result = {
          error: "internal_error",
          message: error instanceof Error ? error.message : String(error)
        };
        process.stdout.write(encodeNativeMessage({ result }));
      }
    })
  );
});

process.stdin.resume();
