import type { Equal, Expect } from "./typeEquality";
import type { HostDirectoryListing as HostListing } from "../services/file/hostBrowse";
import type {
  DirEntry as HostDirEntry,
  MentionDirEntry as HostMentionDirEntry,
} from "../services/file/operations";
import type { UploadedAttachment as HostUploadedAttachment } from "../services/file/uploads";
import type {
  DirEntry,
  HostDirectoryListing,
  MentionDirEntry,
  UploadedAttachment,
} from "@argus/remote-protocol";

export type FileModelChecks = [
  Expect<Equal<DirEntry, HostDirEntry>>,
  Expect<Equal<MentionDirEntry, HostMentionDirEntry>>,
  Expect<Equal<HostDirectoryListing, HostListing>>,
  Expect<Equal<UploadedAttachment, HostUploadedAttachment>>,
];
