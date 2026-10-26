import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../src/tools/shared.js";

const base = {
  name: "thing_delete",
  title: "Delete thing",
  description: "Deletes a thing.",
  kind: "destructive" as const,
  output: z.object({}),
  handler: async () => ({ data: {}, summary: "" }),
};

describe("defineTool", () => {
  it("refuses a destructive tool without preview()", () => {
    expect(() => defineTool({ ...base, input: z.object({ realm: z.string() }) })).toThrow(
      /preview/,
    );
  });

  it("refuses a destructive tool that declares its own confirm field", () => {
    expect(() =>
      defineTool({ ...base, preview: () => "p", input: z.object({ confirm: z.boolean() }) }),
    ).toThrow(/confirm/);
  });
});
