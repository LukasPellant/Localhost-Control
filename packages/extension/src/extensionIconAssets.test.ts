import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readByte(data: Buffer, offset: number): number {
  return data[offset] ?? 0;
}

function decodeRgbaPng(path: string): { data: Buffer; width: number; height: number } {
  const png = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = png.subarray(dataStart, dataStart + length);
    offset = dataStart + length + 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    }

    if (type === "IDAT") {
      chunks.push(data);
    }
  }

  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rows = Buffer.alloc(stride * height);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = readByte(inflated, inputOffset);
    inputOffset += 1;

    for (let x = 0; x < stride; x += 1) {
      const raw = readByte(inflated, inputOffset + x);
      const left = x >= 4 ? readByte(rows, y * stride + x - 4) : 0;
      const above = y > 0 ? readByte(rows, (y - 1) * stride + x) : 0;
      const upperLeft = y > 0 && x >= 4 ? readByte(rows, (y - 1) * stride + x - 4) : 0;
      let value = raw;

      if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + above;
      } else if (filter === 3) {
        value = raw + Math.floor((left + above) / 2);
      } else if (filter === 4) {
        const pa = Math.abs(above - upperLeft);
        const pb = Math.abs(left - upperLeft);
        const pc = Math.abs(left + above - upperLeft * 2);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft);
      } else {
        expect(filter).toBe(0);
      }

      rows[y * stride + x] = value & 0xff;
    }

    inputOffset += stride;
  }

  return { data: rows, width, height };
}

describe("extension icon assets", () => {
  it("keeps the full ghost logo visible in the toolbar icon", () => {
    const icon = decodeRgbaPng(resolve(__dirname, "../public/icons/localhost-control-ghost-16.png"));
    const opaqueXs: number[] = [];
    const opaqueYs: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];

    for (let y = 0; y < icon.height; y += 1) {
      for (let x = 0; x < icon.width; x += 1) {
        const offset = (y * icon.width + x) * 4;
        const red = readByte(icon.data, offset);
        const green = readByte(icon.data, offset + 1);
        const blue = readByte(icon.data, offset + 2);
        const alpha = readByte(icon.data, offset + 3);

        if (alpha > 20) {
          opaqueXs.push(x);
          opaqueYs.push(y);
        }

        if (alpha > 80 && red < 120 && green > 80 && blue > 120) {
          xs.push(x);
          ys.push(y);
        }
      }
    }

    const minOpaqueX = Math.min(...opaqueXs);
    const maxOpaqueX = Math.max(...opaqueXs);
    const minOpaqueY = Math.min(...opaqueYs);
    const maxOpaqueY = Math.max(...opaqueYs);
    const blueWidth = Math.max(...xs) - Math.min(...xs) + 1;
    const blueHeight = Math.max(...ys) - Math.min(...ys) + 1;

    expect(minOpaqueX).toBeGreaterThanOrEqual(1);
    expect(maxOpaqueX).toBeLessThanOrEqual(14);
    expect(minOpaqueY).toBeGreaterThanOrEqual(1);
    expect(maxOpaqueY).toBeLessThanOrEqual(14);
    expect(blueWidth).toBeGreaterThanOrEqual(10);
    expect(blueHeight).toBeGreaterThanOrEqual(10);
  });
});
