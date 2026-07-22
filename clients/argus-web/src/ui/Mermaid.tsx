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

export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`m${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let alive = true;
    loadMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg: rendered }) => {
        if (alive) {
          setSvg(rendered);
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

  return <div className="aw-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
