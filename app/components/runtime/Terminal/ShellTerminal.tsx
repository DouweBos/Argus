import { useEffect } from "react";
import { useTerminal } from "../../../hooks/useTerminal";
import { TerminalSearchBar } from "../../shared/TerminalSearchBar";
import styles from "./ShellTerminal.module.css";

interface ShellTerminalProps {
  onExit?: (code: number) => void;
  sessionId: string;
}

export function ShellTerminal({ sessionId, onExit }: ShellTerminalProps) {
  const {
    terminalRef,
    fit,
    searchVisible,
    searchState,
    hideSearch,
    searchNext,
    searchPrevious,
  } = useTerminal({ sessionId, onExit });

  useEffect(() => {
    const id = requestAnimationFrame(() => fit());

    return () => cancelAnimationFrame(id);
  }, [sessionId, fit]);

  return (
    <div className={styles.wrapper}>
      {searchVisible && (
        <TerminalSearchBar
          resultCount={searchState.resultCount}
          resultIndex={searchState.resultIndex}
          onClose={hideSearch}
          onNext={searchNext}
          onPrevious={searchPrevious}
        />
      )}
      <div ref={terminalRef} className={styles.terminal} />
    </div>
  );
}
