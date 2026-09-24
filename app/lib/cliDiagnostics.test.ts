import { describe, expect, it } from "vitest";
import { parseCliDiagnostic } from "./cliDiagnostics";

describe("parseCliDiagnostic", () => {
  it("humanizes the code and labels each payload field", () => {
    const d = parseCliDiagnostic(
      '[claude-code:unrecognized_model] {"model":"callstack/Apex","query_source":"generate_session_title"}',
    );

    expect(d).toEqual({
      code: "unrecognized_model",
      title: "Unrecognized model",
      details: [
        "Model: callstack/Apex",
        "Query source: generate_session_title",
      ],
    });
  });

  it("keeps a non-JSON payload as its own line", () => {
    expect(parseCliDiagnostic("[claude-code:auth] token expired")?.details).toEqual([
      "token expired",
    ]);
  });

  it("handles a payload-free diagnostic", () => {
    expect(parseCliDiagnostic("[claude-code:offline]")).toEqual({
      code: "offline",
      title: "Offline",
      details: [],
    });
  });

  it("returns null for ordinary stderr", () => {
    expect(parseCliDiagnostic("Error: ENOENT no such file")).toBeNull();
    expect(parseCliDiagnostic("[other:thing] {}")).toBeNull();
  });
});
