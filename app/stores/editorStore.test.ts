import { describe, expect, it, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({ activeWorkspaceId: null });
  });

  it("starts with null workspace", () => {
    expect(useEditorStore.getState().activeWorkspaceId).toBeNull();
  });

  it("sets active workspace", () => {
    useEditorStore.getState().setActiveWorkspace("ws-1");
    expect(useEditorStore.getState().activeWorkspaceId).toBe("ws-1");
  });

  it("clears workspace", () => {
    useEditorStore.getState().setActiveWorkspace("ws-1");
    useEditorStore.getState().clearWorkspace();
    expect(useEditorStore.getState().activeWorkspaceId).toBeNull();
  });

  it("overwrites previous workspace", () => {
    useEditorStore.getState().setActiveWorkspace("ws-1");
    useEditorStore.getState().setActiveWorkspace("ws-2");
    expect(useEditorStore.getState().activeWorkspaceId).toBe("ws-2");
  });
});
