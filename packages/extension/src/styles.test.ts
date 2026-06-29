import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "styles.css");
const styles = readFileSync(stylesPath, "utf8");

const ruleBody = (selector: string): string => {
  const match = styles.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule for ${selector}`);
  const body = match[1];
  if (!body) throw new Error(`Missing CSS body for ${selector}`);
  return body;
};

describe("port row styles", () => {
  it("does not force horizontal scrolling in narrow side panels", () => {
    expect(ruleBody("body")).not.toContain("min-width: 340px");
  });

  it("allows metadata and resource labels to wrap in narrow side panels", () => {
    expect(ruleBody(".port-meta")).toContain("white-space: normal");
    expect(ruleBody(".port-resources")).toContain("white-space: normal");
  });

  it("allows the settings footer controls to wrap instead of widening the side panel", () => {
    expect(ruleBody(".settings-bar")).toContain("flex-wrap: wrap");
  });
});
