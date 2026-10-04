import { defineTypedCommand } from "../services/command/registry";
import {
  listDirectory,
  makeDirectory,
  movePath,
  readFileBytes,
  removePath,
  statPath,
  writeFileBytes,
} from "../services/file/bytes";
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
  defineTypedCommand("read_file_bytes", (p) =>
    readFileBytes(p.id, p.relativePath),
  );
  defineTypedCommand("write_file_bytes", (p) =>
    writeFileBytes(p.id, p.relativePath, p.data, p.executable),
  );
  defineTypedCommand("stat_path", (p) => statPath(p.id, p.relativePath));
  defineTypedCommand("list_directory_names", (p) =>
    listDirectory(p.id, p.relativePath),
  );
  defineTypedCommand("remove_path", (p) => removePath(p.id, p.relativePath));
  defineTypedCommand("make_directory", (p) =>
    makeDirectory(p.id, p.relativePath),
  );
  defineTypedCommand("move_path", (p) => movePath(p.id, p.from, p.to));
}
