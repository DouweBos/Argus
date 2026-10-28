import type { DesignDraft } from "./useDesignDraft";
import { Chip, Icons } from "@argus/peacock";

/** One chip per attached Figma frame. Paste a Figma link to add one. */
export function DesignChips({ draft }: { draft: DesignDraft }) {
  if (draft.designs.length === 0 && !draft.adding) {
    return null;
  }

  return (
    <>
      {draft.designs.map(({ ref }) => (
        <Chip
          key={ref.url}
          leading={<Icons.FigmaIcon size={10} />}
          title={ref.url}
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
