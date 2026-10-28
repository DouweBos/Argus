import type { Equal, Expect } from "./typeEquality";
import type { StoredIntegration } from "../services/integrations/credentials";
import type { IntegrationStatus } from "@argus/remote-protocol";

export type IntegrationModelChecks = [
  Expect<
    Equal<StoredIntegration["method"], NonNullable<IntegrationStatus["method"]>>
  >,
];
