import path from "node:path";
import { defineConfig } from "vitest/config";
import root from "../../../vitest.config";

// Runs the conversation fixture generator through vitest so it can stub the
// host's app state the way the host's own tests do. `include` is replaced, not
// merged, so only the generator runs.
export default defineConfig({
  ...root,
  root: path.resolve(__dirname, "../../.."),
  test: {
    ...root.test,
    include: ["clients/argus-ios/Tools/gen-conversation-fixtures.ts"],
  },
});
