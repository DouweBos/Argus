/** The Figma frames a session builds against, each opening the design viewer. */

import { Chip, Icons } from "@argus/peacock";
import type { RemoteSession } from "../../lib/protocol";
import { openDesign } from "../../routing/open";

export function SessionDesignChips({
  session,
}: {
  session: Pick<RemoteSession, "design_refs" | "id">;
}) {
  if (!session.design_refs?.length) {
    return null;
  }

  return (
    <div className="aw-chip-row">
      {session.design_refs.map((ref) => (
        <Chip
          key={ref.url}
          interactive
          leading={<Icons.FigmaIcon size={10} />}
          title={`${ref.name} — open in the design viewer`}
          onClick={() =>
            openDesign(ref.url, { sessionId: session.id, source: "session" })
          }
        >
          {ref.name}
        </Chip>
      ))}
    </div>
  );
}
