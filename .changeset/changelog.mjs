// changesets loads its generator with require(); tsx lets that be the TypeScript one.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("tsx/cjs");

export default require("../scripts/changesets/changelog.ts").default;
