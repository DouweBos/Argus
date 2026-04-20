import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSession,
  getEditorState,
  setActiveSession,
  setEditorState,
} from "./editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    setEditorState({ activeSessionId: null });
  });

  it("starts with null session", () => {
    expect(getEditorState().activeSessionId).toBeNull();
  });

  it("sets active session", () => {
    setActiveSession("ws-1");
    expect(getEditorState().activeSessionId).toBe("ws-1");
  });

  it("clears session", () => {
    setActiveSession("ws-1");
    clearSession();
    expect(getEditorState().activeSessionId).toBeNull();
  });

  it("overwrites previous session", () => {
    setActiveSession("ws-1");
    setActiveSession("ws-2");
    expect(getEditorState().activeSessionId).toBe("ws-2");
  });
});
