import { useEffect, useState } from "react";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  name: string;
  /** Image URL (e.g. a Gravatar). Falls back to initials on load failure. */
  src?: string | null;
  /** Pixel diameter. Optional — if omitted, sizing comes from CSS. */
  size?: number;
  className?: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({ name, src, size, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const classes = [styles.avatar, className].filter(Boolean).join(" ");
  const sizeStyle = size ? { width: size } : undefined;

  if (src && !failed) {
    return (
      <img
        alt={name}
        className={classes}
        src={src}
        style={sizeStyle}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className={classes} style={sizeStyle} aria-label={name}>
      {initialsOf(name)}
    </span>
  );
}
