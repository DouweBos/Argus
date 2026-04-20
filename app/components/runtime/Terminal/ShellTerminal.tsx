import { useEffect } from "react";
import { useTerminal } from "../../../hooks/useTerminal";
import { TerminalSearchBar } from "../../shared/TerminalSearchBar";
import styles from "./ShellTerminal.module.css";

interface ShellTerminalProps {
  isActive?: boolean;
  onExit?: (code: number) => void;
  sessionId: string;
}

export function ShellTerminal({
  sessionId,
  onExit,
  isActive = true,
}: ShellTerminalProps) {
  const {
    terminalRef,
    terminal,
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

  // Focus the xterm whenever this terminal becomes the active tab so the
  // pty receives keystrokes (e.g. Metro's `R`). Without this, terminals
  // created via the run flow stayed unfocused and swallowed input.
  useEffect(() => {
    if (!terminal || !isActive) {
      return;
    }
    const id = requestAnimationFrame(() => terminal.focus());

    return () => cancelAnimationFrame(id);
  }, [terminal, isActive]);

  return (
    <div className={styles.wrapper} onMouseDown={() => terminal?.focus()}>
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
