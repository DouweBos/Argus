/** The design viewer, loaded on first use so the entry bundle doesn't carry it. */

import { lazy, Suspense } from "react";
import { Spinner } from "@argus/peacock";
import type { DesignScreenState } from "./DesignScreen";

const DesignScreen = lazy(() => import("./DesignScreen"));

export function LazyDesignScreen({ screen }: { screen: DesignScreenState }) {
  return (
    <Suspense
      fallback={
        <div className="aw-center">
          <Spinner />
        </div>
      }
    >
      <DesignScreen screen={screen} />
    </Suspense>
  );
}
