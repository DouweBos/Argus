import { describe, expect, it } from "vitest";
import { describeSimctlFailure, simulatorProblem } from "./simctlProblems";

const MISSING = `Error: Command failed: xcrun simctl boot 40DBE9EA-B881-4DB3-8142-D1430B63278F
An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2):
Unable to boot device because it cannot be located on disk.
The device's data is no longer present at /Users/someone/Library/Developer/CoreSimulator/Devices/40DBE9EA/data.
Use the device manager in Xcode or the simctl command line tool to either delete the device properly or erase contents and settings.`;

describe("describeSimctlFailure", () => {
  it("names a missing data folder without the dump", () => {
    expect(describeSimctlFailure(MISSING)).toEqual({
      reason: "missing_data",
      message: "This simulator's data is missing.",
    });
  });

  it("names a missing runtime", () => {
    expect(
      describeSimctlFailure("Unable to boot: runtime profile not found").reason,
    ).toBe("runtime_missing");
  });

  it("keeps the first meaningful line of anything else", () => {
    const failure = describeSimctlFailure(
      `Error: Command failed: xcrun simctl boot X
An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):
Something odd happened.`,
    );
    expect(failure).toEqual({
      reason: "unknown",
      message: "Couldn't start the simulator: Something odd happened.",
    });
  });

  it("says which action failed", () => {
    expect(describeSimctlFailure("", "erase").message).toBe(
      "Couldn't erase the simulator.",
    );
  });
});

describe("simulatorProblem", () => {
  it("flags a data folder that is gone", () => {
    expect(
      simulatorProblem({ isAvailable: true, dataPath: "/gone" }, () => false)
        ?.kind,
    ).toBe("missing_data");
  });

  it("flags a device simctl marks unavailable", () => {
    expect(
      simulatorProblem({
        isAvailable: false,
        availabilityError:
          'runtime profile not found using "System" match policy',
      }),
    ).toEqual({
      kind: "unavailable",
      message: "This simulator's runtime isn't installed.",
    });
  });

  it("passes a healthy device", () => {
    expect(
      simulatorProblem({ isAvailable: true, dataPath: "/here" }, () => true),
    ).toBeUndefined();
  });
});
