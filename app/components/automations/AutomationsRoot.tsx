import { useCurrentRoute } from "../../lib/routeHooks";
import { AutomationDetailScreen } from "./AutomationDetailScreen/AutomationDetailScreen";
import { AutomationRunScreen } from "./AutomationRunScreen/AutomationRunScreen";
import { AutomationsScreen } from "./AutomationsScreen/AutomationsScreen";

/** Picks the automations screen the URL asks for — list, config, or one run. */
export function AutomationsRoot() {
  const { automationId, automationRunId } = useCurrentRoute();

  if (automationId && automationRunId) {
    return <AutomationRunScreen />;
  }
  if (automationId) {
    return <AutomationDetailScreen />;
  }

  return <AutomationsScreen />;
}
