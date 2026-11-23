import { describe, expect, it } from "vitest";
import {
  type ApiErrorBody,
  apiErrorDetail,
} from "../src/lib/management-api-error";

describe("apiErrorDetail", () => {
  it("returns the code, message and hint of an ordinary error body", () => {
    expect(
      apiErrorDetail({
        error: {
          code: "quota-exceeded",
          message: "This workspace has 100 custom domains.",
          hint: "Delete one first.",
        },
      }),
    ).toEqual({
      code: "quota-exceeded",
      message: "This workspace has 100 custom domains.",
      hint: "Delete one first.",
    });
  });

  it.each([
    { name: "no body", body: undefined },
    { name: "a body without error", body: {} },
    { name: "a null error", body: { error: null } },
    {
      name: "a list of validation issues",
      body: { error: [{ path: ["hostname"], message: "Invalid" }] },
    },
    { name: "a string error", body: { error: "Bad Request" } },
  ])("returns no detail for $name", ({ body }) => {
    expect(apiErrorDetail(body as ApiErrorBody | undefined)).toEqual({});
  });
});
