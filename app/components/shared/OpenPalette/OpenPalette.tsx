import { type ReactNode, useMemo, useState } from "react";
import { Icons, type PaletteGroup, PaletteDialog } from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import {
  closeOpenPalette,
  useOpenPaletteOpen,
} from "../../../stores/openPaletteStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import {
  selectSession,
  useSelectedSessionId,
  useSessions,
} from "../../../stores/sessionStore";

type OpenGroup = "open-project" | "recent-project" | "session";

interface OpenItem {
  group: OpenGroup;
  hint?: string[];
  icon: ReactNode;
  id: string;
  keywords: string;
  run: () => void;
  sublabel?: string;
  title: string;
}

const GROUP_LABELS: Record<OpenGroup, string> = {
  session: "Sessions",
  "open-project": "Open projects",
  "recent-project": "Recent projects",
};

const GROUP_ORDER: OpenGroup[] = ["open-project", "recent-project", "session"];

export function OpenPalette() {
  const open = useOpenPaletteOpen();
  if (!open) {
    return null;
  }

  return <OpenPaletteContent />;
}

function OpenPaletteContent() {
  const recent = useRecentProjects();
  const sessions = useSessions();
  const selectedId = useSelectedSessionId();
  const { openProject } = useProjects();
  const [query, setQuery] = useState("");

  const items = useMemo<OpenItem[]>(() => {
    const out: OpenItem[] = [];

    const sortedSessions = [...sessions].sort((a, b) => {
      const repoCmp = a.repo_root.localeCompare(b.repo_root);
      if (repoCmp !== 0) {
        return repoCmp;
      }

      return a.branch.localeCompare(b.branch);
    });

    sortedSessions.forEach((w) => {
      const isCurrent = w.id === selectedId;
      out.push({
        group: "session",
        id: `session:${w.id}`,
        title: w.branch,
        sublabel: `${basename(w.repo_root)}${isCurrent ? " · current" : ""}`,
        icon: <Icons.ArgusLogo size={13} />,
        keywords: `${w.branch} ${w.repo_root} ${w.kind} session switch`,
        run: () => {
          closeOpenPalette();
          if (!isCurrent) {
            selectSession(w.id);
          }
        },
      });
    });

    const openRepoRoots = new Set(sessions.map((w) => w.repo_root));
    recent.forEach((p) => {
      const isOpen = openRepoRoots.has(p.path);
      out.push({
        group: isOpen ? "open-project" : "recent-project",
        id: `project:${p.path}`,
        title: p.name,
        sublabel: p.path,
        icon: <Icons.FolderIcon size={13} />,
        keywords: `${p.name} ${p.path} repo project open`,
        run: () => {
          closeOpenPalette();
          openProject(p.path, { hostId: p.hostId }).catch(() => {});
        },
      });
    });

    return out;
  }, [recent, sessions, selectedId, openProject]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items;
    }

    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.keywords.toLowerCase().includes(q) ||
        (it.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  const groups = useMemo(() => groupItems(filtered), [filtered]);
  const byId = useMemo(
    () => new Map(filtered.map((it) => [it.id, it])),
    [filtered],
  );

  return (
    <PaletteDialog
      ariaLabel="Search projects and sessions"
      groups={groups}
      placeholder="Search projects and sessions…"
      query={query}
      onClose={closeOpenPalette}
      onQueryChange={setQuery}
      onSelect={(item) => byId.get(item.id)?.run()}
    />
  );
}

function groupItems(items: OpenItem[]): PaletteGroup[] {
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    items: items
      .filter((it) => it.group === key)
      .map(({ hint, icon, id, sublabel, title }) => ({
        hint,
        icon,
        id,
        sublabel,
        title,
      })),
  })).filter((g) => g.items.length > 0);
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
