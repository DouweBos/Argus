import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number;
  className?: string;
};

export function CloseIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
    </svg>
  );
}

export function PlusIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
    </svg>
  );
}

export function PlayIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4 2l10 6-10 6V2z" />
    </svg>
  );
}

/** Two-bar shape used for the agent start button. */
export function AgentStartIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M3 2.5a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.764.424L.5 12.03A1 1 0 0 1 0 11.13V4.87a1 1 0 0 1 .5-.9L2.736 2.576A.5.5 0 0 1 3 2.5zm4 0a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.764.424L4.5 12.03A1 1 0 0 1 4 11.13V4.87a1 1 0 0 1 .5-.9L6.736 2.576A.5.5 0 0 1 7 2.5z" />
    </svg>
  );
}

export function CheckIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022z" />
    </svg>
  );
}

export function TrashIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
      <path
        d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function PencilIcon({ size = 10, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
    </svg>
  );
}

export function StopIcon({ size = 13, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <rect height="10" rx="1" width="10" x="3" y="3" />
    </svg>
  );
}

export function PauseIcon({ size = 13, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <rect height="10" rx="1" width="3" x="4" y="3" />
      <rect height="10" rx="1" width="3" x="9" y="3" />
    </svg>
  );
}

export function ScrollToBottomIcon({
  size = 13,
  className,
  ...rest
}: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 2v8" />
      <path d="M4.5 7L8 10.5 11.5 7" />
      <path d="M3 13.25h10" />
    </svg>
  );
}

export function SendIcon({ size = 13, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576 6.636 10.07Zm6.787-8.201L1.591 6.602l4.339 2.76 7.494-7.493Z" />
    </svg>
  );
}

export function PaperclipIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z" />
    </svg>
  );
}

export function CropIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4 1v11h11" />
      <path d="M1 4h11v11" />
    </svg>
  );
}

export function EllipsisIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
    </svg>
  );
}

export function CopyIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
    </svg>
  );
}

export function QuestionIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM.5 8a7.5 7.5 0 1 1 15 0 7.5 7.5 0 0 1-15 0Zm5.255-2.61c.18-1.06 1.097-1.89 2.245-1.89 1.252 0 2.293.95 2.293 2.18 0 .79-.42 1.34-1.034 1.797-.183.137-.355.255-.51.36l-.039.026c-.16.108-.296.2-.41.291-.215.17-.291.301-.291.452a.5.5 0 0 1-1 0c0-.557.318-.939.668-1.215.146-.115.31-.226.464-.331l.026-.018c.156-.106.301-.205.434-.304.461-.345.692-.624.692-1.058 0-.626-.554-1.18-1.293-1.18-.703 0-1.21.499-1.26 1.057a.5.5 0 0 1-.985-.167ZM8 12.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
    </svg>
  );
}

export function HomeIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5ZM13 7.207V13.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.207l5-5 5 5Z" />
    </svg>
  );
}

export function MergeIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

export function ReviewQueueIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.3"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M2 3.25 L3.25 4.5 L5 2.5" />
      <line x1="7" x2="14" y1="3.25" y2="3.25" />
      <circle cx="3" cy="8" r="1" />
      <line x1="7" x2="14" y1="8" y2="8" />
      <circle cx="3" cy="12.75" r="1" />
      <line x1="7" x2="14" y1="12.75" y2="12.75" />
    </svg>
  );
}

export function TerminalIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2z" />
      <path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12z" />
    </svg>
  );
}

export function CodeIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M5.5 4 2 8l3.5 4" />
      <path d="M10.5 4 14 8l-3.5 4" />
    </svg>
  );
}

export function LogsIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.3"
      viewBox="0 0 16 16"
      width={size}
    >
      <rect height="15" rx="1.5" width="11" x="2.5" y="0.5" />
      <line x1="5" x2="11" y1="4.5" y2="4.5" />
      <line x1="5" x2="11" y1="7" y2="7" />
      <line x1="5" x2="11" y1="9.5" y2="9.5" />
      <line x1="5" x2="8.5" y1="12" y2="12" />
    </svg>
  );
}

export function BootIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 1a.5.5 0 0 1 .5.5v4.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 6.293V1.5A.5.5 0 0 1 8 1zm-5 8a.5.5 0 0 1 .5.5v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3a.5.5 0 0 1 1 0v3a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-3A.5.5 0 0 1 3 9z" />
    </svg>
  );
}

export function DisconnectIcon({ size = 12, className, ...rest }: IconProps) {
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
      <path d="M6.5 9.5 4 12a2.12 2.12 0 0 1-3-3l2.5-2.5" />
      <path d="m3 8 2 2" />
      <path d="m1 11 2 2" />
      <path d="m9.5 6.5 2.5-2.5a2.12 2.12 0 0 1 3 3L12.5 9.5" />
      <path d="m11 6 2 2" />
      <path d="m13 3 2 2" />
    </svg>
  );
}

export function RepoIcon({ size = 11, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

export function BranchIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
    </svg>
  );
}

export function FileIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.414A2 2 0 0 0 13.414 3L11 .586A2 2 0 0 0 9.586 0H4zm5.586 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.414a1 1 0 0 0-.293-.707L9.586 1z" />
    </svg>
  );
}

export function DownloadIcon({ size = 12, className, ...rest }: IconProps) {
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
      <path d="M8 2v8" />
      <path d="M4.5 7 8 10.5 11.5 7" />
      <path d="M2.5 12.5v1A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  );
}

export function UploadIcon({ size = 12, className, ...rest }: IconProps) {
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
      <path d="M8 14V6" />
      <path d="M4.5 9 8 5.5 11.5 9" />
      <path d="M2.5 3.5v-1A1.5 1.5 0 0 1 4 1h8a1.5 1.5 0 0 1 1.5 1.5v1" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 8, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        d="M10 4l-4 4 4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ChevronRightIcon({ size = 8, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ChevronDownIcon({ size = 10, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 0-.708z" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 10, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4.646 11.354a.5.5 0 0 0 .708 0L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708l-3-3a.5.5 0 0 0-.708 0l-3 3a.5.5 0 0 0 0 .708z" />
    </svg>
  );
}

export function LeftSidebarIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <rect
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        width="14"
        x="1"
        y="2"
      />
      <line
        stroke="currentColor"
        strokeWidth="1.3"
        x1="5.5"
        x2="5.5"
        y1="2"
        y2="14"
      />
    </svg>
  );
}

export function SplitViewIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <rect
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        width="14"
        x="1"
        y="2"
      />
      <line
        stroke="currentColor"
        strokeWidth="1.3"
        x1="8"
        x2="8"
        y1="2"
        y2="14"
      />
    </svg>
  );
}

export function RightSidebarIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <rect
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        width="14"
        x="1"
        y="2"
      />
      <line
        stroke="currentColor"
        strokeWidth="1.3"
        x1="10.5"
        x2="10.5"
        y1="2"
        y2="14"
      />
    </svg>
  );
}

export function ArgusLogo({ size = 48, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      viewBox="0 0 120 120"
      width={size}
    >
      <defs>
        <radialGradient id="argus-logo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="55" fill="url(#argus-logo-glow)" />
      <circle
        cx="60"
        cy="60"
        r="22"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <circle cx="60" cy="60" r="6" fill="var(--accent)" />
      <circle
        cx="60"
        cy="60"
        r="40"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1"
        strokeDasharray="3 5"
        opacity="0.5"
      />
    </svg>
  );
}

export function FolderIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1.5 3A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.414l-1-1H1.5Z" />
    </svg>
  );
}

export function GearIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.421-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
    </svg>
  );
}

export function HistoryIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function LinearIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 100 100"
      width={size}
    >
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228Z" />
      <path d="M.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624Z" />
      <path d="M4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855Z" />
      <path d="M12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
    </svg>
  );
}

export type StagedState = "full" | "none" | "partial";

export function StagedIcon({
  staged,
  size = 16,
  className,
  ...rest
}: IconProps & { staged?: StagedState }) {
  if (staged === "full") {
    return (
      <svg
        className={className}
        {...rest}
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <circle cx="8" cy="8" fill="var(--accent)" r="7" />
        <path
          d="M5 8l2 2 4-4"
          fill="none"
          stroke="var(--accent-fg)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (staged === "partial") {
    return (
      <svg
        className={className}
        {...rest}
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <circle cx="8" cy="8" fill="var(--error)" r="7" />
        <path
          d="M5 8h6"
          stroke="var(--error-fg)"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      {...rest}
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <circle
        cx="8"
        cy="8"
        fill="none"
        opacity="0.4"
        r="6.5"
        stroke="var(--text-muted)"
        strokeWidth="1"
      />
    </svg>
  );
}

export function TreeFolderIcon({
  open,
  size = 14,
  className,
  ...rest
}: IconProps & { open?: boolean }) {
  if (open) {
    return (
      <svg
        className={className}
        {...rest}
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <path
          d="M1.5 3A1.5 1.5 0 013 1.5h3.19a1.5 1.5 0 011.06.44L8.56 3.25H13A1.5 1.5 0 0114.5 4.75v.25H2V4.5A1.5 1.5 0 013.5 3h0z"
          fill="var(--folder-icon-shadow)"
        />
        <path
          d="M1.5 5h13l-1.5 8.5H3L1.5 5z"
          fill="var(--folder-icon-fill)"
          opacity="0.85"
        />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      {...rest}
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        d="M1.5 3A1.5 1.5 0 013 1.5h3.19a1.5 1.5 0 011.06.44L8.56 3.25H13A1.5 1.5 0 0114.5 4.75V12A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12V3z"
        fill="#c09553"
      />
    </svg>
  );
}

/** Tool rail icons */

export function GitChangesIcon({ size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    </svg>
  );
}

export function TerminalToolIcon({ size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM3.47 5.47a.75.75 0 0 1 1.06 0l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 1 1-1.06-1.06L4.94 8 3.47 6.53a.75.75 0 0 1 0-1.06Zm4.28 4.28a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}

export function SimulatorIcon({ size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4.5 0A2.5 2.5 0 0 0 2 2.5v11A2.5 2.5 0 0 0 4.5 16h7a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 11.5 0h-7ZM3.5 2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11ZM7 12.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" />
    </svg>
  );
}

export function RefreshIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M13.25 8a5.25 5.25 0 1 1-1.53-3.71" />
      <path d="M13.25 2.25V4.5h-2.25" />
    </svg>
  );
}

export function ArrowBackIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06z"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function ArrowForwardIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        d="M8.22 3.47a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.19 9H3.75a.75.75 0 0 1 0-1.5h7.44L8.22 4.53a.75.75 0 0 1 0-1.06z"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4.5 11.5 11.5 4.5" />
      <path d="M5.25 4.5h6.25v6.25" />
    </svg>
  );
}

export function ArrowDownLeftIcon({
  size = 12,
  className,
  ...rest
}: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M11.5 4.5 4.5 11.5" />
      <path d="M10.75 11.5H4.5V5.25" />
    </svg>
  );
}

export function EnlargeIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707zm4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707z" />
    </svg>
  );
}

export function PopoutIcon({ size = 12, className, ...rest }: IconProps) {
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
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 8 8" />
      <path d="M12.5 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3" />
    </svg>
  );
}

export function ShrinkIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1.525 1.525a.5.5 0 0 1 .707 0L5.5 4.793V2.5a.5.5 0 0 1 1 0v3.975a.5.5 0 0 1-.5.5H2.025a.5.5 0 0 1 0-1h2.293L1.525 2.232a.5.5 0 0 1 0-.707zm12.95 12.95a.5.5 0 0 1-.707 0L10.5 11.207V13.5a.5.5 0 0 1-1 0V9.525a.5.5 0 0 1 .5-.5h3.975a.5.5 0 0 1 0 1h-2.293l2.793 2.793a.5.5 0 0 1 0 .707z" />
    </svg>
  );
}

export function OrchestrationIcon({
  size = 14,
  className,
  ...rest
}: IconProps) {
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
      <circle cx="8" cy="3" r="2" />
      <circle cx="4" cy="13" r="2" />
      <circle cx="12" cy="13" r="2" />
      <line x1="8" x2="4" y1="5" y2="11" />
      <line x1="8" x2="12" y1="5" y2="11" />
    </svg>
  );
}

export function SearchIcon({ size = 13, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
    </svg>
  );
}

export function WebIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z" />
    </svg>
  );
}

export function VideoIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        fillRule="evenodd"
        d="M0 5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.983 1.738l3.11-1.382A1 1 0 0 1 16 4.269v7.462a1 1 0 0 1-1.406.913l-3.111-1.382A2 2 0 0 1 9.5 13H2a2 2 0 0 1-2-2V5z"
      />
    </svg>
  );
}

export function AgentIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z" />
    </svg>
  );
}

export function MinusIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z" />
    </svg>
  );
}

export function FilterIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z" />
    </svg>
  );
}

export function FetchIcon({ size = 15, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 2a.5.5 0 0 1 .5.5v6.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 9.293V2.5A.5.5 0 0 1 8 2z" />
      <path d="M2 13.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
}

export function PullIcon({ size = 15, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 1a.5.5 0 0 1 .5.5v9.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L7.5 11.293V1.5A.5.5 0 0 1 8 1z" />
    </svg>
  );
}

export function PushIcon({ size = 15, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 15a.5.5 0 0 1-.5-.5V4.707L5.354 6.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 4.707V14.5A.5.5 0 0 1 8 15z" />
    </svg>
  );
}

export function ApplyStashIcon({ size = 15, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z" />
      <path d="M8 7.5a.5.5 0 0 1 .5.5v2.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 10.793V8a.5.5 0 0 1 .5-.5z" />
    </svg>
  );
}

export function SaveStashIcon({ size = 15, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z" />
      <path d="M8 12.5a.5.5 0 0 1-.5-.5V9.207L6.354 10.354a.5.5 0 1 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 9.207V12a.5.5 0 0 1-.5.5z" />
    </svg>
  );
}

export function StashIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z" />
      <path d="M3 7v7.5A1.5 1.5 0 0 0 4.5 16h7a1.5 1.5 0 0 0 1.5-1.5V7H3zm2 1.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
}

export function WorkingCopyIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.414A2 2 0 0 0 13.414 3L11 .586A2 2 0 0 0 9.586 0H4zm5.586 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.414a1 1 0 0 0-.293-.707L9.586 1z" />
      <path d="M6.5 7.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
}

export function ClockIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z" />
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
    </svg>
  );
}

export function AndroidBackIcon({ size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function AndroidHomeIcon({ size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function AndroidRecentsIcon({
  size = 18,
  className,
  ...rest
}: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <rect height="12" rx="1" width="12" x="6" y="6" />
    </svg>
  );
}

export function WarningIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  );
}

/** A cluster of four rounded squares — used to represent an organization grouping multiple repos. */
export function OrganizationIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <rect x="1.25" y="1.25" width="5.5" height="5.5" rx="1.25" />
      <rect
        x="9.25"
        y="1.25"
        width="5.5"
        height="5.5"
        rx="1.25"
        opacity="0.65"
      />
      <rect
        x="1.25"
        y="9.25"
        width="5.5"
        height="5.5"
        rx="1.25"
        opacity="0.65"
      />
      <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1.25" />
    </svg>
  );
}

export function BugIcon({ size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M5.25 5.25h5.5a2 2 0 0 1 2 2v2.25a4.25 4.25 0 0 1-8.5 0V7.25a2 2 0 0 1 1-1.73Z" />
      <path d="M6 5.25V4.5a2 2 0 1 1 4 0v.75" />
      <path d="M8 9v3.75" />
      <path d="M2.75 7.5h1.75M2.75 11h2" />
      <path d="M13.25 7.5H11.5M13.25 11h-2" />
      <path d="M3.5 4.25 5 5.5M12.5 4.25 11 5.5" />
    </svg>
  );
}

export function LinkIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M6.75 9.25 9.25 6.75" />
      <path d="M7.25 4.75 8.5 3.5a2.475 2.475 0 0 1 3.5 3.5L10.75 8.25" />
      <path d="M8.75 11.25 7.5 12.5a2.475 2.475 0 0 1-3.5-3.5L5.25 7.75" />
    </svg>
  );
}

export function TagIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M2 1a1 1 0 0 0-1 1v4.586a1 1 0 0 0 .293.707l7 7a1 1 0 0 0 1.414 0l4.586-4.586a1 1 0 0 0 0-1.414l-7-7A1 1 0 0 0 6.586 1H2zm4 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
    </svg>
  );
}

export function SlidersIcon({ size = 12, className, ...rest }: IconProps) {
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
      <line x1="2" x2="14" y1="4" y2="4" />
      <line x1="2" x2="14" y1="8" y2="8" />
      <line x1="2" x2="14" y1="12" y2="12" />
      <circle cx="5" cy="4" fill="currentColor" r="1.5" stroke="none" />
      <circle cx="10" cy="8" fill="currentColor" r="1.5" stroke="none" />
      <circle cx="6" cy="12" fill="currentColor" r="1.5" stroke="none" />
    </svg>
  );
}

export function TaskIcon({
  size = 12,
  className,
  done = false,
  ...rest
}: IconProps & { done?: boolean }) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
      width={size}
    >
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" />
      {done && <path d="M5.25 8.25 L7.25 10.25 L10.75 5.75" />}
    </svg>
  );
}

/** Six dots in a 2×3 grid — decorative drag handle. */
export function GripDotsIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <circle cx="5.5" cy="4" r="1.25" />
      <circle cx="10.5" cy="4" r="1.25" />
      <circle cx="5.5" cy="8" r="1.25" />
      <circle cx="10.5" cy="8" r="1.25" />
      <circle cx="5.5" cy="12" r="1.25" />
      <circle cx="10.5" cy="12" r="1.25" />
    </svg>
  );
}

/** Vertical two-headed arrow used as the image-diff slider handle. */
export function ImageDiffSliderIcon({
  size = 16,
  className,
  ...rest
}: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M8 1.5 L5 5 H7.25 V11 H5 L8 14.5 L11 11 H8.75 V5 H11 Z" />
    </svg>
  );
}

/** Pushpin icon — used to mark pinned branches in the sidebar. */
export function PinIcon({ size = 12, className, ...rest }: IconProps) {
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
      <path d="M9.5 1.5 L14.5 6.5 L10.5 10.5 L10.5 12.5 L8 15 L5.5 12.5 L5.5 10.5 L1.5 6.5 L5.5 2.5 Z" />
      <line x1="8" y1="8" x2="2" y2="14" />
    </svg>
  );
}

export function BlameIcon({ size = 12, className, ...rest }: IconProps) {
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
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 13.5c0-2.485 2.015-4.5 4.5-4.5s4.5 2.015 4.5 4.5" />
      <line x1="11" y1="3" x2="14.5" y2="3" />
      <line x1="11" y1="6" x2="14.5" y2="6" />
      <line x1="11" y1="9" x2="14.5" y2="9" />
    </svg>
  );
}

export function UndoIcon({ size = 13, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6" />
      <path d="M5.5 3.5 2.5 6.5l3 3" />
    </svg>
  );
}

export function RedoIcon({ size = 13, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
      width={size}
    >
      <path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H10" />
      <path d="M10.5 3.5l3 3-3 3" />
    </svg>
  );
}

export function EnvelopeIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      {...rest}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
      width={size}
    >
      <rect height="9" rx="1.5" width="12" x="2" y="3.5" />
      <path d="M2.5 4.5 8 9l5.5-4.5" />
    </svg>
  );
}
