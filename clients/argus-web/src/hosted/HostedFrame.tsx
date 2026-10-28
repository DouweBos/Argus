import type { ReactNode } from "react";
import { Icons } from "@argus/peacock";

/** The single-column page every hosted screen before the monitor sits in. */
export function HostedFrame({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="aw-shell aw-hosted">
      <header className="aw-hero">
        <Icons.ArgusLogo size={24} />
        <h1 className="aw-title">{title}</h1>
        {actions && <div className="aw-hosted-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
