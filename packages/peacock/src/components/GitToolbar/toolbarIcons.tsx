import type { SVGProps } from "react";

/**
 * Stroked icons used inside the Git toolbar. They share a single
 * 16-grid viewbox and a 1.5 stroke so the strip reads as one consistent set.
 *
 * These are scoped to the toolbar; the rest of the app keeps using the
 * existing Peacock icon set (filled, multi-grid). Importing them from here
 * avoids muddying the global icon palette.
 */

export type ToolbarIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number;
  className?: string;
};

interface IcProps extends ToolbarIconProps {
  children: React.ReactNode;
}

function Ic({ size = 14, children, className, ...rest }: IcProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width={size}
    >
      {children}
    </svg>
  );
}

/** Cloud with a down-pointing arrow. Used for Pull. */
export function CloudDownIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <path d="M11.5 12H4.5a3 3 0 0 1 0-6 4 4 0 0 1 7.7-1A2.5 2.5 0 0 1 11.5 12z" />
      <path d="M8 7v5M6 10.5L8 12.5l2-2" />
    </Ic>
  );
}

/** Cloud with an up-pointing arrow. Used for Push. */
export function CloudUpIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <path d="M11.5 12H4.5a3 3 0 0 1 0-6 4 4 0 0 1 7.7-1A2.5 2.5 0 0 1 11.5 12z" />
      <path d="M8 13V8M6 9.5L8 7.5l2 2" />
    </Ic>
  );
}

/** Safe / locker silhouette. Used for Stash. */
export function ToolbarStashIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <rect height="8" rx="1" width="12" x="2" y="6" />
      <path d="M5 6V4a3 3 0 0 1 6 0v2" />
    </Ic>
  );
}

/** Branch icon — three nodes connected with a fork. Used for Branch. */
export function ToolbarBranchIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="3.5" r="1.5" />
      <path d="M4 5v6M12 5v2c0 2.5-2 3-4 3.5" />
    </Ic>
  );
}

/** Angled tag with a punched hole. Used for Tag. */
export function ToolbarTagIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <path d="M2 6.5v-3a1 1 0 0 1 1-1h3l8 8-4 4-8-8z" />
      <circle cx="5" cy="5.5" fill="currentColor" r="0.6" stroke="none" />
    </Ic>
  );
}

/** Three nodes converging. Used for Merge. */
export function ToolbarMergeIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M4 5.5v5M5.5 4c0 2.5 2 4 5 4" />
    </Ic>
  );
}

/** Curved horseshoe arrow pointing back. Used for Undo. */
export function ToolbarUndoIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <path d="M3 7.5h7a3.5 3.5 0 0 1 0 7H8M3 7.5l3-3M3 7.5l3 3" />
    </Ic>
  );
}

/** Curved horseshoe arrow pointing forward. Used for Redo. */
export function ToolbarRedoIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <path d="M13 7.5H6a3.5 3.5 0 0 0 0 7h2M13 7.5l-3-3M13 7.5l-3 3" />
    </Ic>
  );
}

/** Circular refresh with double tick. Used for Refresh. */
export function ToolbarRefreshIcon(props: ToolbarIconProps) {
  return (
    <Ic {...props}>
      <path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4" />
      <path d="M11 4h2.5V1.5M5 12H2.5V14.5" />
    </Ic>
  );
}
