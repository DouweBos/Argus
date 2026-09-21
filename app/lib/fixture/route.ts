/**
 * Fixture runs deep-link straight to the screen being captured. The route rides
 * in on the query string — the app routes through `MemoryRouter`, which ignores
 * the address bar.
 *
 * It is applied *after* boot rather than as an `initialEntries` seed: sessions
 * are hydrated asynchronously, and a `/sessions/:id` entry that resolves before
 * they land bounces straight back to Home.
 */
export async function applyFixtureRoute(route?: string): Promise<void> {
  // Only an absent route is a no-op. "/" is a real destination: a recording
  // that ends by going Home has to be able to ask for it.
  if (!route) {
    return;
  }
  const { navigateToPath } = await import("../router");
  navigateToPath(route, { exact: true });
}

/** Open the named agent's tab in each session that declares one. */
export async function applyActiveAgents(
  active: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(active);
  if (entries.length === 0) {
    return;
  }
  const { setActiveAgent } = await import("../../stores/agentStore");
  for (const [sessionId, agentId] of entries) {
    setActiveAgent(sessionId, agentId);
  }
}

/** Open the settings dialog on a named section. */
export async function applySettingsSection(section?: string): Promise<void> {
  if (!section) {
    return;
  }
  const { showSettingsDialog } = await import("../../stores/settingsStore");
  showSettingsDialog(section);
}
