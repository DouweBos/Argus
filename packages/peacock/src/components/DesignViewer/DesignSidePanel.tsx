import type { FigmaFrameDetails } from "@argus/remote-protocol";
import { DesignLayerList } from "../DesignLayerList/DesignLayerList";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import styles from "./DesignViewer.module.css";

/** Side-panel tab of the design viewer. */
export type DesignViewerTab = "comments" | "layers" | "pages";

export interface DesignSidePanelProps {
  details: FigmaFrameDetails;
  /** True for the page-list frame that is the one on screen. */
  isCurrentFrame: (url: string) => boolean;
  onOpenFrame: (url: string) => void;
  onTabChange: (tab: DesignViewerTab) => void;
  tab: DesignViewerTab;
}

/** Layers, designer comments, and the file's other frames. */
export function DesignSidePanel({
  details,
  isCurrentFrame,
  onOpenFrame,
  onTabChange,
  tab,
}: DesignSidePanelProps) {
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
      <SegmentedControl<DesignViewerTab>
        aria-label="Frame details"
        className={styles.tabs}
        options={tabs}
        value={tab}
        onChange={onTabChange}
      />
      <div className={styles.sideBody}>
        {tab === "layers" &&
          (details.layers.length > 0 ? (
            <DesignLayerList layers={details.layers} />
          ) : (
            <p className={styles.muted}>No layers.</p>
          ))}
        {tab === "comments" && <Comments details={details} />}
        {tab === "pages" && (
          <Pages
            details={details}
            isCurrentFrame={isCurrentFrame}
            onOpenFrame={onOpenFrame}
          />
        )}
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

function Pages({
  details,
  isCurrentFrame,
  onOpenFrame,
}: Pick<DesignSidePanelProps, "details" | "isCurrentFrame" | "onOpenFrame">) {
  return (
    <>
      {details.pages.map((page) => (
        <section key={page.name} className={styles.page}>
          <h3 className={styles.pageName}>{page.name}</h3>
          {page.frames.length === 0 && (
            <p className={styles.muted}>No frames.</p>
          )}
          {page.frames.map((frame) => {
            const active = isCurrentFrame(frame.url);

            return (
              <button
                key={frame.url}
                type="button"
                className={`${styles.frameLink} ${active ? styles.frameLinkActive : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onOpenFrame(frame.url)}
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
