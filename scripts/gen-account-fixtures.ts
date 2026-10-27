/**
 * Writes the account log golden fixtures (shared with the Swift tests).
 * Run: `pnpm gen:account-fixtures`
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildFixtures } from "@argus/host/services/account/fixtureBuilder";

const FIXTURE_DIR = path.join(
  import.meta.dirname,
  "../packages/remote-protocol/src/account/fixtures",
);

for (const [file, data] of Object.entries(buildFixtures())) {
  writeFileSync(
    path.join(FIXTURE_DIR, file),
    `${JSON.stringify(data, null, 2)}\n`,
  );
}
