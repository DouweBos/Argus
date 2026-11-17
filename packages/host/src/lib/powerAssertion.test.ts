import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { powerAssertion } from "./powerAssertion";

function fakeSpawn() {
  const calls: string[][] = [];
  const children: (EventEmitter & { kill: () => void; unref: () => void })[] =
    [];
  const fn = vi.fn((_cmd: string, args: string[]) => {
    calls.push(args);
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => child.emit("exit")),
      unref: vi.fn(),
    });
    children.push(child);

    return child;
  });

  return { fn: fn as unknown as typeof spawn, calls, children };
}

describe("powerAssertion", () => {
  it("spawns one caffeinate tied to this process and kills it on release", () => {
    const spawn = fakeSpawn();
    const assertion = powerAssertion(["-s"], spawn.fn, "darwin");

    assertion.hold();
    assertion.hold();
    expect(spawn.calls).toEqual([["-s", "-w", String(process.pid)]]);
    expect(assertion.held).toBe(true);

    assertion.release();
    expect(spawn.children[0].kill).toHaveBeenCalled();
    expect(assertion.held).toBe(false);
  });

  it("re-holds after caffeinate exits on its own", () => {
    const spawn = fakeSpawn();
    const assertion = powerAssertion(["-s"], spawn.fn, "darwin");

    assertion.hold();
    spawn.children[0].emit("exit");
    expect(assertion.held).toBe(false);

    assertion.hold();
    expect(spawn.calls).toHaveLength(2);
  });

  it("does nothing off macOS", () => {
    const spawn = fakeSpawn();
    const assertion = powerAssertion(["-s"], spawn.fn, "linux");

    assertion.hold();
    expect(spawn.calls).toHaveLength(0);
    expect(assertion.held).toBe(false);
  });
});
