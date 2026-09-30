/**
 * Every command the host core serves, registered against the catalog in
 * `@argus/remote-protocol`. The desktop shell adds its window- and
 * dialog-bound commands on top; a headless host runs with these alone.
 */

import { registerFileCommands } from "./files";

export function registerHostCommands(): void {
  registerFileCommands();
}
