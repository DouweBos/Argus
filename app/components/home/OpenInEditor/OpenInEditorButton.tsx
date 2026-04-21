import { useState } from "react";
import {
  Button,
  ContextMenu,
  Icons,
  type ContextMenuItem,
} from "@argus/peacock";
import { openInCustomEditor, openInEditor } from "../../../lib/ipc";
import { useCustomEditors } from "../../../stores/settingsStore";
import { useEditors } from "./useEditors";

interface OpenInEditorButtonProps {
  path: string;
}

export function OpenInEditorButton({ path }: OpenInEditorButtonProps) {
  const editors = useEditors();
  const customEditors = useCustomEditors();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const available = editors.filter((e) => e.available);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
  };

  const builtinItems: ContextMenuItem[] = available.map((ed) => ({
    label: `Open in ${ed.name}`,
    onClick: () => {
      openInEditor(ed.id, path).catch(() => undefined);
    },
  }));

  const customItems: ContextMenuItem[] = customEditors.map((ed) => ({
    label: `Open in ${ed.name}`,
    onClick: () => {
      openInCustomEditor(ed.command, path).catch(() => undefined);
    },
  }));

  let items: ContextMenuItem[];
  if (builtinItems.length === 0 && customItems.length === 0) {
    items = [
      {
        label: "No apps detected",
        disabled: true,
        onClick: () => undefined,
      },
    ];
  } else if (builtinItems.length > 0 && customItems.length > 0) {
    items = [...builtinItems, { separator: true }, ...customItems];
  } else {
    items = [...builtinItems, ...customItems];
  }

  return (
    <>
      <Button
        variant="ghost"
        leading={<Icons.PopoutIcon size={12} />}
        trailing={<Icons.ChevronDownIcon size={10} />}
        onClick={handleClick}
        title="Open this directory in an external app"
      >
        Open in
      </Button>
      {menuPos && (
        <ContextMenu
          items={items}
          position={menuPos}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}
