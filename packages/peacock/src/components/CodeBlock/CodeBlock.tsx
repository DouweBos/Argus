import { useState } from "react";
import styles from "./CodeBlock.module.css";

export interface CodeBlockProps {
  code: string;
  language?: string;
  copyable?: boolean;
}

export function CodeBlock({ code, language, copyable = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  };

  return (
    <div className={styles.block}>
      <pre className={styles.pre} data-language={language}>
        <code>{code}</code>
      </pre>
      {copyable ? (
        <button type="button" className={styles.copy} onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
    </div>
  );
}
