import { describe, expect, it } from "vitest";
import { generateCode } from "../src/utils/code.js";

// No 0/O or 1/I.
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

describe("generateCode", () => {
  it.each(["DR", "TR"])("makes %s-XXXXXX codes from the unambiguous alphabet", (prefix) => {
    for (let i = 0; i < 200; i++) {
      const [head, code] = generateCode(prefix).split("-");
      expect(head).toBe(prefix);
      expect(code).toMatch(CODE);
    }
  });

  it("rarely repeats", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateCode("TR")));
    // 32^6 ≈ 1 billion codes: a repeat in 1000 is about a 1-in-2000 chance.
    expect(codes.size).toBeGreaterThanOrEqual(999);
  });
});
