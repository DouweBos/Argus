import type { SVGProps } from "react";

type IconProps = { size?: number; className?: string } & Omit<
  SVGProps<SVGSVGElement>,
  "ref"
>;

export function SparkleIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <path d="M8 0l1.5 4.5L14 6l-4.5 1.5L8 12l-1.5-4.5L2 6l4.5-1.5L8 0ZM13 9l.7 2.1L16 12l-2.3.9L13 15l-.7-2.1L10 12l2.3-.9L13 9Z" />
    </svg>
  );
}

export function WarningIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm1 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  );
}

/** Stroke-style commit dot — distinct from the filled MergeIcon family. */
export function CommitIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.3}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <circle cx="8" cy="8" r="2.5" />
      <path d="M0 8h5.5M10.5 8H16" />
    </svg>
  );
}

export function WebIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeWidth={1.3}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
    </svg>
  );
}

/** 2×2 grid icon (layout toggle). */
export function GridIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

export function ListIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <rect x="1" y="3" width="14" height="2" rx="1" />
      <rect x="1" y="7" width="14" height="2" rx="1" />
      <rect x="1" y="11" width="14" height="2" rx="1" />
    </svg>
  );
}

export interface StarIconProps extends IconProps {
  filled?: boolean;
}

export function StarIcon({
  size = 11,
  className,
  filled,
  ...rest
}: StarIconProps) {
  return (
    <svg
      className={className}
      fill={filled ? "currentColor" : "none"}
      height={size}
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={1.3}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <path d="M8 2l1.8 3.9 4.2.5-3.2 2.9.9 4.2L8 11.4l-3.7 2.1.9-4.2L2 6.4l4.2-.5L8 2Z" />
    </svg>
  );
}

export function LinkIssueIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.4}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <path d="M7 9a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 1 0-4.2-4.2L8 3.7" />
      <path d="M9 7a3 3 0 0 0-4.2 0L2.5 9.3a3 3 0 1 0 4.2 4.2L8 12.3" />
    </svg>
  );
}

export function PauseIcon({ size = 10, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <rect x="3" y="2" width="3.5" height="12" rx="1" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
    </svg>
  );
}

export function SearchIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.4}
      viewBox="0 0 16 16"
      width={size}
      {...rest}
    >
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 3 3" />
    </svg>
  );
}
