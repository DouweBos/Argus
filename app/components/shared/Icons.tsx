/**
 * Icon shim — re-exports all icons from @argus/peacock and supplements with
 * app-specific icons that depend on app-local utilities (e.g. FileTypeIcon).
 *
 * All consumers should continue importing from this path; the canonical icon
 * source of truth is packages/peacock/src/icons/Icons.tsx.
 */
import { fileExtLabel, fileIconColor } from "../../lib/fileIcons";

export * from "@argus/peacock/icons";

interface IconPropsLocal {
  className?: string;
  size?: number;
}

interface FileTypeIconProps extends IconPropsLocal {
  name: string;
}

/** App-specific icon: renders a file extension badge inside a file outline. */
export function FileTypeIcon({
  name,
  size = 14,
  className,
}: FileTypeIconProps) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const color = fileIconColor(ext);
  const label = fileExtLabel(ext);

  return (
    <svg className={className} height={size} viewBox="0 0 16 16" width={size}>
      <path
        d="M3 1.5h6.5L13 5v9.5H3z"
        fill="none"
        opacity="0.5"
        stroke={color}
        strokeWidth="1"
      />
      <path
        d="M9.5 1.5V5H13"
        fill="none"
        opacity="0.5"
        stroke={color}
        strokeWidth="1"
      />
      <text
        fill={color}
        fontFamily="var(--font-ui)"
        fontSize="6"
        fontWeight="700"
        textAnchor="middle"
        x="8"
        y="12"
      >
        {label}
      </text>
    </svg>
  );
}
