import { useCurrentRoute } from "../../lib/routeHooks";
import { AutomationDetailScreen } from "./AutomationDetailScreen/AutomationDetailScreen";
import { AutomationRunScreen } from "./AutomationRunScreen/AutomationRunScreen";
import { AutomationsScreen } from "./AutomationsScreen/AutomationsScreen";
import { QuickRunScreen } from "./QuickRunScreen/QuickRunScreen";

/**
 * Picks the automations screen the URL asks for — list, config, the ad-hoc
 * surface, or one run.
 */
export function AutomationsRoot() {
  const { automationId, automationQuick, automationRunId } = useCurrentRoute();

  if (automationQuick) {
    return automationRunId ? <AutomationRunScreen /> : <QuickRunScreen />;
  }
  if (automationId && automationRunId) {
    return <AutomationRunScreen />;
  }
  if (automationId) {
    return <AutomationDetailScreen />;
  }

  return <AutomationsScreen />;
}
