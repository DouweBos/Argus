import type { DesignTab } from "../../../lib/routerDesign";
import type { FigmaFrameDetails } from "../../../lib/types";
import { DesignLayerList, SegmentedControl } from "@argus/peacock";
import { figmaFrameKey, updateDesignViewer } from "../../../lib/designViewer";
import styles from "./DesignViewer.module.css";

interface DesignSidePanelProps {
  details: FigmaFrameDetails;
  tab: DesignTab;
}

/** Layers, designer comments, and the file's other frames. */
export function DesignSidePanel({ details, tab }: DesignSidePanelProps) {
  const tabs = [
    { value: "layers" as const, label: `Layers ${details.layers.length}` },
    {
      value: "comments" as const,
      label: `Comments ${details.comments.length}`,
    },
    { value: "pages" as const, label: "Pages" },
  ];

  return (
    <aside className={styles.side}>
      <SegmentedControl<DesignTab>
        aria-label="Frame details"
        className={styles.tabs}
        options={tabs}
        value={tab}
        onChange={(next) => updateDesignViewer({ tab: next })}
      />
      <div className={styles.sideBody}>
        {tab === "layers" &&
          (details.layers.length > 0 ? (
            <DesignLayerList layers={details.layers} />
          ) : (
            <p className={styles.muted}>No layers.</p>
          ))}
        {tab === "comments" && <Comments details={details} />}
        {tab === "pages" && <Pages details={details} />}
      </div>
    </aside>
  );
}

function Comments({ details }: { details: FigmaFrameDetails }) {
  if (details.comments.length === 0) {
    return <p className={styles.muted}>No comments on this frame.</p>;
  }

  return (
    <>
      {details.comments.map((comment, i) => (
        <div key={i} className={styles.comment}>
          <span className={styles.commentAuthor}>{comment.author}</span>
          <p className={styles.commentBody}>{comment.body}</p>
        </div>
      ))}
    </>
  );
}

function Pages({ details }: { details: FigmaFrameDetails }) {
  const current = `${details.ref.fileKey}:${details.ref.nodeId ?? ""}`;

  return (
    <>
      {details.pages.map((page) => (
        <section key={page.name} className={styles.page}>
          <h3 className={styles.pageName}>{page.name}</h3>
          {page.frames.length === 0 && (
            <p className={styles.muted}>No frames.</p>
          )}
          {page.frames.map((frame) => {
            const active = figmaFrameKey(frame.url) === current;

            return (
              <button
                key={frame.url}
                type="button"
                className={`${styles.frameLink} ${active ? styles.frameLinkActive : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => updateDesignViewer({ url: frame.url })}
              >
                {frame.name}
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}
