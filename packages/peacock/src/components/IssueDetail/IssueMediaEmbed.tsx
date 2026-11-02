import { ArrowUpRightIcon, LinkIcon, VideoIcon } from "../../icons/Icons";
import { InlineVideo } from "../InlineVideo/InlineVideo";
import styles from "./IssueDetail.module.css";

export interface IssueMediaEmbedProps {
  error?: string | null;
  kind: "image" | "video";
  label: string;
  /**
   * A loadable copy of the upload; null while it loads. `"link"` when this
   * client can't fetch it (uploads need the computer's sign-in), so it stays a link.
   */
  src: string | "link" | null;
  /** The upload's own address, for the link. */
  url: string;
}

/** A Linear screenshot or screen recording inline in an issue's text. */
export function IssueMediaEmbed({
  error,
  kind,
  label,
  src,
  url,
}: IssueMediaEmbedProps) {
  const name = label || (kind === "video" ? "Video" : "Image");
  if (src === "link") {
    return (
      <a
        className={styles.embedLink}
        href={url}
        rel="noreferrer noopener"
        target="_blank"
      >
        {kind === "video" ? <VideoIcon size={13} /> : <LinkIcon size={12} />}
        <span className={styles.rowTitle}>{name}</span>
        <ArrowUpRightIcon size={11} />
      </a>
    );
  }
  if (kind === "video") {
    return <InlineVideo error={error} label={name} src={src} />;
  }

  return src ? (
    <img alt={name} className={styles.embedImage} src={src} />
  ) : null;
}
