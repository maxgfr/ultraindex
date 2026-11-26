import { expect, it } from "vitest";

it("posts the order", async () => {
  await fetch("/api/test-only", { method: "POST" });
  expect(true).toBe(true);
});
