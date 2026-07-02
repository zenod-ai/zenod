import { describe, expect, it } from "vitest";
import { foldImageUrlIntoMessage } from "../src/meshGateway.js";

describe("foldImageUrlIntoMessage", () => {
  it("folds image_url into the message and drops it as a separate arg", () => {
    const out = foldImageUrlIntoMessage({ message: "post this", image_url: "https://example.com/a.png" });
    expect(out.image_url).toBeUndefined();
    expect(String(out.message)).toContain("post this");
    expect(String(out.message)).toContain("image_url: https://example.com/a.png");
  });

  it("passes the message through untouched when no image is given", () => {
    const out = foldImageUrlIntoMessage({ message: "just text" });
    expect(out).toEqual({ message: "just text" });
  });

  it("ignores a blank image_url", () => {
    const out = foldImageUrlIntoMessage({ message: "x", image_url: "   " });
    expect(out.image_url).toBeUndefined();
    expect(out.message).toBe("x");
  });
});
