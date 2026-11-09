import { useEffect, useRef, useState } from "react";

// Lazily-loaded mermaid renderer — the library is heavy, so it's only pulled
// in when a transcript actually contains a ```mermaid diagram.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((m) => {
    const theme =
      document.documentElement.dataset.theme === "light" ? "default" : "dark";
    // Pin strict sanitization — diagram source is attacker-influenceable (agent
    // output / repo content), so never let the DOMPurify sanitizer be downgraded.
    m.default.initialize({ startOnLoad: false, theme, securityLevel: "strict" });

    return m.default;
  });

  return mermaidPromise;
}

export interface SvgImage {
  src: string;
  width?: number;
  height?: number;
}

/**
 * Turns mermaid's SVG markup into an `<img>` source. Browsers never run script
 * in an SVG loaded as an image, so a sanitizer bypass can't reach this page.
 */
export function svgToImage(markup: string): SvgImage | null {
  // HTML parsing tolerates mermaid's `<br>` labels; DOMParser documents never run script.
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) {
    return null;
  }
  const [, , w, h] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const sized = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  if (sized) {
    // A standalone SVG with `width="100%"` has no intrinsic size; give it one.
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
  }
  const xml = new XMLSerializer().serializeToString(svg);

  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`,
    ...(sized ? { width: Math.ceil(w), height: Math.ceil(h) } : {}),
  };
}

export function Mermaid({ code }: { code: string }) {
  const [image, setImage] = useState<SvgImage | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`m${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let alive = true;
    loadMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg }) => {
        if (!alive) {
          return;
        }
        const next = svgToImage(svg);
        if (next) {
          setImage(next);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
        }
      });

    return () => {
      alive = false;
    };
  }, [code]);

  if (failed) {
    return <pre className="aw-tool-result">{code}</pre>;
  }

  return (
    <div className="aw-mermaid">
      {image && (
        <img src={image.src} width={image.width} height={image.height} alt="Diagram" />
      )}
    </div>
  );
}
