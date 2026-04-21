import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { revealInFinder } from "../../../lib/ipc";
import styles from "./PathLink.module.css";

interface PathLinkProps {
  className?: string;
  path: string;
  style?: CSSProperties;
}

export function PathLink({ path, className, style }: PathLinkProps) {
  const [metaDown, setMetaDown] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setMetaDown(e.metaKey || e.ctrlKey);
    };
    const onBlur = () => setMetaDown(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div
      className={[styles.path, metaDown ? styles.armed : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      title="⌘-click to reveal in Finder"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          revealInFinder(path).catch(() => {});
        }
      }}
    >
      {path}
    </div>
  );
}
