import type { DesignDraft } from "./useDesignDraft";
import { Chip, Icons } from "@argus/peacock";

/** One chip per attached Figma frame. Paste a Figma link to add one; click one to view it. */
export function DesignChips({
  draft,
  onOpen,
}: {
  draft: DesignDraft;
  onOpen: (url: string) => void;
}) {
  if (draft.designs.length === 0 && !draft.adding) {
    return null;
  }

  return (
    <>
      {draft.designs.map(({ ref }) => (
        <Chip
          key={ref.url}
          leading={<Icons.FigmaIcon size={10} />}
          title={`${ref.name} — open in the design viewer`}
          onClick={() => onOpen(ref.url)}
          onDismiss={() => draft.remove(ref.url)}
        >
          {ref.name}
        </Chip>
      ))}
      {draft.adding && (
        <Chip muted leading={<Icons.FigmaIcon size={10} />}>
          Adding design…
        </Chip>
      )}
    </>
  );
}
