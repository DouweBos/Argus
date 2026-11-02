/**
 * A transcript's scroll: pinned to the newest message while you're at the
 * bottom, older pages lazy-loaded near the top without the view jumping.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export function useTranscriptScroll<T>({
  endRef,
  content,
  mounted,
  canLoadOlder,
  loadOlder,
}: {
  /** A node at the end of the list; its `.aw-main` ancestor is the scroller. */
  endRef: RefObject<HTMLDivElement | null>;
  /** Changes whenever the rows do. */
  content: T;
  /** The list is on screen (re-attaches the listener once it is). */
  mounted: boolean;
  canLoadOlder: () => boolean;
  loadOlder: () => Promise<void>;
}): { isAtBottom: boolean; loadingOlder: boolean; scrollToBottom: () => void } {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  // Height just before older messages prepend, to keep the reader's place.
  const preHeightRef = useRef<number | null>(null);
  const olderRef = useRef({ canLoadOlder, loadOlder });
  useLayoutEffect(() => {
    olderRef.current = { canLoadOlder, loadOlder };
  });

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setIsAtBottom(true);
  }, [endRef]);

  useEffect(() => {
    const scroller = endRef.current?.closest(".aw-main");
    if (!scroller) {
      return;
    }
    const onScroll = () => {
      setIsAtBottom(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60,
      );
      const older = olderRef.current;
      if (scroller.scrollTop < 160 && !loadingRef.current && older.canLoadOlder()) {
        loadingRef.current = true;
        preHeightRef.current = scroller.scrollHeight;
        setLoadingOlder(true);
        older
          .loadOlder()
          .catch(() => {})
          .finally(() => {
            loadingRef.current = false;
            setLoadingOlder(false);
          });
      }
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => scroller.removeEventListener("scroll", onScroll);
  }, [endRef, mounted]);

  // Older messages prepended: offset by the added height.
  useLayoutEffect(() => {
    if (preHeightRef.current == null) {
      return;
    }
    const scroller = endRef.current?.closest(".aw-main");
    if (scroller) {
      scroller.scrollTop += scroller.scrollHeight - preHeightRef.current;
    }
    preHeightRef.current = null;
  }, [endRef, content]);

  // Pin to the bottom before paint, so a streamed message never flashes at the old position.
  useLayoutEffect(() => {
    if (!isAtBottom) {
      return;
    }
    const scroller = endRef.current?.closest(".aw-main");
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [endRef, content, isAtBottom]);

  return { isAtBottom, loadingOlder, scrollToBottom };
}
