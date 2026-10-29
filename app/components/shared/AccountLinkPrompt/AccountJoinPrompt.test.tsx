// @vitest-environment jsdom
/**
 * A device waiting to join shows up wherever the window is: Review hands it
 * to the console approval (which then shows the code), Not now puts it away.
 */

import type * as IpcModule from "../../../lib/ipc";
import type { AccountJoinRequest, AccountStatus } from "../../../lib/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveMock = vi.fn((_id: string) =>
  Promise.resolve({ kind: "idle" as const }),
);
const fake: { linked: boolean; requests: AccountJoinRequest[] } = {
  requests: [],
  linked: true,
};

vi.mock("../../../hooks/useIpcEvent", () => ({
  useIpcEvent: () => undefined,
}));

vi.mock("../../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  accountGetStatus: () =>
    Promise.resolve({
      linked: fake.linked,
      device_id: null,
      config: { hosts_can_approve: true },
    } as unknown as AccountStatus),
  accountListRequests: () => Promise.resolve(fake.requests),
  accountApproveJoin: (id: string) => approveMock(id),
}));

// Out here, not in each test: the real ipc module is slow to load on a busy run.
const { AccountJoinPrompt } = await import("./AccountJoinPrompt");

const tablet: AccountJoinRequest = {
  request_id: "req-1",
  kind: "device",
  subject_name: "Douwe's iPhone",
  subject_role: "device",
  subject_kind: "ios",
  status: "claimed",
  created_at: 0,
  expires_at: Date.now() + 600_000,
};

describe("accountJoinPrompt", () => {
  beforeEach(() => {
    approveMock.mockClear();
    fake.requests = [tablet];
    fake.linked = true;
  });

  it("asks to review a waiting device and starts the approval", async () => {
    render(<AccountJoinPrompt />);

    await screen.findByText("Douwe's iPhone wants to join your account");
    expect(screen.getByText(/An iPhone is asking/)).toBeTruthy();
    fireEvent.click(screen.getByText("Review"));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("req-1"));
    await waitFor(() =>
      expect(
        screen.queryByText("Douwe's iPhone wants to join your account"),
      ).toBeNull(),
    );
  });

  it("puts it away on Not now and stays quiet while not linked", async () => {
    const { unmount } = render(<AccountJoinPrompt />);
    await screen.findByText("Douwe's iPhone wants to join your account");
    fireEvent.click(screen.getByText("Not now"));
    await waitFor(() => expect(screen.queryByText(/wants to join/)).toBeNull());
    expect(approveMock).not.toHaveBeenCalled();
    unmount();

    fake.linked = false;
    render(<AccountJoinPrompt />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/wants to join/)).toBeNull();
  });
});
