import { useEffect, useState } from "react";
import { listEditors, type EditorDescriptor } from "../../../lib/ipc";

let cache: EditorDescriptor[] | null = null;
let inflight: Promise<EditorDescriptor[]> | null = null;

async function load(): Promise<EditorDescriptor[]> {
  if (cache) {
    return cache;
  }
  if (!inflight) {
    inflight = listEditors().then((r) => {
      cache = r;
      inflight = null;

      return r;
    });
  }

  return inflight;
}

/** Shared across callers so we only probe the filesystem once per session. */
export function useEditors(): EditorDescriptor[] {
  const [editors, setEditors] = useState<EditorDescriptor[]>(() => cache ?? []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (!cancelled) {
          setEditors(r);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return editors;
}
