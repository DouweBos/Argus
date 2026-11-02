import type { LinearMedia as Media } from "@argus/client-core";
import { useEffect, useState } from "react";
import { IssueMediaEmbed } from "@argus/peacock";
import { linearMedia } from "../../../lib/ipc";

interface Loaded {
  error: string | null;
  src: string | null;
  url: string;
}

/** A Linear upload through the host's signed-in copy, as a URL this window can load. */
export function LinearMedia({ media }: { media: Media }) {
  const { url } = media;
  const [state, setState] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    linearMedia(url).then(
      (file) =>
        !cancelled &&
        setState({
          url,
          src: `argus-file://local${encodeURI(file.path)}`,
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
  const current = state?.url === url ? state : null;

  return (
    <IssueMediaEmbed
      error={current?.error}
      kind={media.kind}
      label={media.label}
      src={current?.src ?? null}
      url={url}
    />
  );
}
