/** The Issues screens, loaded on first use so the entry bundle doesn't carry them. */

import { lazy, Suspense } from "react";
import { Spinner } from "@argus/peacock";
import type { IssuesScreenState } from "./IssuesScreen";

const IssuesScreen = lazy(() => import("./IssuesScreen"));

export function LazyIssuesScreen({ screen }: { screen: IssuesScreenState }) {
  return (
    <Suspense
      fallback={
        <div className="aw-center">
          <Spinner />
        </div>
      }
    >
      <IssuesScreen screen={screen} />
    </Suspense>
  );
}
