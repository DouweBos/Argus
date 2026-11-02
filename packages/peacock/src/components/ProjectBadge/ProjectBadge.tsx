import type { CSSProperties, HTMLAttributes } from "react";
import { projectAccent } from "../../lib/projectAccent";
import styles from "./ProjectBadge.module.css";

/** Two letters for a project: the first of two words, else its first two. */
export function projectInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${words[0][0]}${words[1][0]}`
      : (words[0] ?? name).slice(0, 2);

  return letters.toUpperCase();
}

export interface ProjectBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  /** The project's path, which picks its colour; without one it stays neutral. */
  projectKey?: string;
  size?: "lg" | "md" | "sm";
}

/** A project's coloured initials, as Argus for Mac draws them. */
export function ProjectBadge({
  name,
  projectKey,
  size = "sm",
  className,
  ...rest
}: ProjectBadgeProps) {
  // The project palette is data, not theme: the tint rides a custom property.
  const tint = projectKey
    ? ({ "--project-tint": projectAccent(projectKey) } as CSSProperties)
    : undefined;

  return (
    <span
      aria-hidden
      className={[
        styles.badge,
        styles[size],
        projectKey ? styles.tinted : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={tint}
      {...rest}
    >
      {projectInitials(name)}
    </span>
  );
}
