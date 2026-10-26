import type {
  CliProjectCandidate,
  CliProjectImportSource,
  CliProjectScan,
} from "../../../lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultSelection } from "../../../lib/cliProjectImport";
import { importCliProjects, scanCliProjects } from "../../../lib/ipc";
import { LOCAL_HOST_ID, type HostId } from "../../../lib/transport/hostId";
import { addRecentProject } from "../../../stores/recentProjectsStore";

export interface CliProjectPicker {
  error: string | null;
  importing: boolean;
  /** Adds the picked projects; throws when the host refuses. */
  importPicked: () => Promise<void>;
  /** When the scan landed; ages are relative to it. */
  now: number;
  picked: Set<string>;
  scan: CliProjectScan | null;
  setPicked: (picked: Set<string>) => void;
  /** Candidates that aren't projects here yet. */
  suggestions: CliProjectCandidate[];
  toggle: (path: string, on: boolean) => void;
}

/** Scans Claude Code CLI history on mount and adds the picked projects. */
export function useCliProjectPicker(
  source: CliProjectImportSource,
  hostId: HostId = LOCAL_HOST_ID,
): CliProjectPicker {
  const [scan, setScan] = useState<CliProjectScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let live = true;
    scanCliProjects(source)
      .then((result) => {
        if (live) {
          const at = Date.now();
          setNow(at);
          setScan(result);
          setPicked(defaultSelection(result.candidates, at));
        }
      })
      .catch((err: unknown) => {
        if (live) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      live = false;
    };
  }, [source]);

  const suggestions = useMemo(
    () => (scan?.candidates ?? []).filter((c) => !c.added),
    [scan],
  );

  const toggle = useCallback((path: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(path);
      } else {
        next.delete(path);
      }

      return next;
    });
  }, []);

  const importPicked = useCallback(async () => {
    const paths = [...picked];
    setImporting(true);
    try {
      await importCliProjects(paths, source);
      for (const path of paths) {
        addRecentProject(path, hostId);
      }
    } finally {
      setImporting(false);
    }
  }, [picked, source, hostId]);

  return {
    error,
    importing,
    importPicked,
    now,
    picked,
    scan,
    setPicked,
    suggestions,
    toggle,
  };
}
