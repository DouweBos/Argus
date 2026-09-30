import { defineTypedCommand } from "../services/command/registry";
import {
  createRunTerminal,
  createTerminal,
  destroyTerminal,
  listTerminals,
  startTerminal,
  stopTerminal,
  terminalResize,
  terminalWrite,
  updateTerminalTitle,
} from "../services/terminal/multiplexer";

export function registerTerminalCommands(): void {
  defineTypedCommand("create_terminal", (p) =>
    createTerminal(p.sessionId, p.subDir, undefined, p.title),
  );
  defineTypedCommand("create_run_terminal", (p) =>
    createRunTerminal(p.sessionId, p.title),
  );
  defineTypedCommand("list_terminals", (p) => listTerminals(p.sessionId));
  defineTypedCommand("update_terminal_title", (p) =>
    updateTerminalTitle(p.terminalId, p.title),
  );
  defineTypedCommand("start_terminal", (p) =>
    startTerminal(p.sessionId, p.cols, p.rows),
  );
  defineTypedCommand("destroy_terminal", (p) => destroyTerminal(p.sessionId));
  defineTypedCommand("stop_terminal", (p) => stopTerminal(p.sessionId));
  defineTypedCommand("terminal_write", (p) =>
    terminalWrite(p.sessionId, p.data),
  );
  defineTypedCommand("terminal_resize", (p) =>
    terminalResize(p.sessionId, p.cols, p.rows),
  );
}
