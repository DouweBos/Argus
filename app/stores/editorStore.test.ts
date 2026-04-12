import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkspace,
  getEditorState,
  setActiveWorkspace,
  setEditorState,
} from "./editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    setEditorState({ activeWorkspaceId: null });
  });

  it("starts with null workspace", () => {
    expect(getEditorState().activeWorkspaceId).toBeNull();
  });

  it("sets active workspace", () => {
    setActiveWorkspace("ws-1");
    expect(getEditorState().activeWorkspaceId).toBe("ws-1");
  });

  it("clears workspace", () => {
    setActiveWorkspace("ws-1");
    clearWorkspace();
    expect(getEditorState().activeWorkspaceId).toBeNull();
  });

  it("overwrites previous workspace", () => {
    setActiveWorkspace("ws-1");
    setActiveWorkspace("ws-2");
    expect(getEditorState().activeWorkspaceId).toBe("ws-2");
  });
});
