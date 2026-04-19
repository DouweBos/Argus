/**
 * Icon shim — re-exports all icons from @argus/peacock and supplements with
 * app-specific icons that depend on app-local utilities (e.g. FileTypeIcon).
 *
 * All consumers should continue importing from this path; the canonical icon
 * source of truth is packages/peacock/src/icons/Icons.tsx.
 */
import { FileTypeBadge } from "@argus/peacock";
import { fileExtLabel, fileIconColor } from "../../lib/fileIcons";

// eslint-disable-next-line react-refresh/only-export-components -- re-export shim for the Peacock icon pack
export * from "@argus/peacock/icons";

interface FileTypeIconProps {
  className?: string;
  name: string;
  size?: number;
}

/** App wrapper: derives color + label from the filename, then delegates to Peacock. */
export function FileTypeIcon({
  className,
  name,
  size = 14,
}: FileTypeIconProps) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  return (
    <FileTypeBadge
      className={className}
      color={fileIconColor(ext)}
      label={fileExtLabel(ext)}
      size={size}
    />
  );
}
