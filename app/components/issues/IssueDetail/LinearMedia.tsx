import { useEffect, useState } from "react";
import { InlineVideo } from "@argus/peacock";
import { linearMedia } from "../../../lib/ipc";
import styles from "./IssueDetail.module.css";

/** The host's signed-in copy of a Linear upload, as a URL this window can load. */
function useLinearMedia(url: string): {
  error: string | null;
  src: string | null;
} {
  const [state, setState] = useState<{
    error: string | null;
    src: string | null;
    url: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    linearMedia(url).then(
      (media) =>
        !cancelled &&
        setState({
          url,
          src: `argus-file://local${encodeURI(media.path)}`,
          error: null,
        }),
      (err: unknown) =>
        !cancelled &&
        setState({
          url,
          src: null,
          error: err instanceof Error ? err.message : String(err),
        }),
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state?.url === url ? state : { src: null, error: null };
}

export function LinearVideo({ label, url }: { label: string; url: string }) {
  const { src, error } = useLinearMedia(url);

  return <InlineVideo error={error} label={label} src={src} />;
}

export function LinearImage({ label, url }: { label: string; url: string }) {
  const { src } = useLinearMedia(url);

  return src ? (
    <img alt={label} className={styles.embedImage} src={src} />
  ) : null;
}
