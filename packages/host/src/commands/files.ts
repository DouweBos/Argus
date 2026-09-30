import { defineTypedCommand } from "../services/command/registry";
import { listHostDirectory } from "../services/file/hostBrowse";
import {
  listPath,
  listSessionFiles,
  readFile,
  resolveMentionPath,
  statFile,
  writeFile,
} from "../services/file/operations";
import { uploadSessionAttachment } from "../services/file/uploads";

export function registerFileCommands(): void {
  defineTypedCommand("read_file", (p) => readFile(p.id, p.relativePath));
  defineTypedCommand("write_file", (p) =>
    writeFile(p.id, p.relativePath, p.content),
  );
  defineTypedCommand("stat_file", (p) => statFile(p.id, p.relativePath));
  defineTypedCommand("list_session_files", (p) => listSessionFiles(p.id));
  defineTypedCommand("resolve_mention_path", (p) =>
    resolveMentionPath(p.id, p.query),
  );
  defineTypedCommand("upload_session_attachment", (p) =>
    uploadSessionAttachment(p.id, p.name, p.data),
  );
  defineTypedCommand("list_path", (p) => listPath(p.path));
  defineTypedCommand("list_host_directory", (p) => listHostDirectory(p.path));
}
