import { readCodeFile, writeCodeFile } from "../services/code/files";
import { cancelCodeSearch, startCodeSearch } from "../services/code/search";
import { unwatchCodeFiles, watchCodeFiles } from "../services/code/watch";
import { defineTypedCommand } from "../services/command/registry";

export function registerCodeCommands(): void {
  defineTypedCommand("code_read_file", (p) =>
    readCodeFile(p.id, p.relativePath),
  );
  defineTypedCommand("code_write_file", (p) =>
    writeCodeFile(p.id, p.relativePath, p.content, p.baseHash, p.force),
  );
  defineTypedCommand("code_watch_files", (p) => watchCodeFiles(p.id, p.paths));
  defineTypedCommand("code_unwatch_files", (p) =>
    unwatchCodeFiles(p.id, p.paths),
  );
  defineTypedCommand("code_search", ({ id, searchId, ...query }) =>
    startCodeSearch(id, query, searchId),
  );
  defineTypedCommand("code_search_cancel", (p) => cancelCodeSearch(p.searchId));
}
