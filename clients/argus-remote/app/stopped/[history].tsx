import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AgentTranscript } from "../../src/components/AgentTranscript";
import * as Icons from "../../src/components/Icons";
import { Banner, Btn, HeaderIconBtn, Muted, Row } from "../../src/components/ui";
import { stoppedAgentKey, useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

/**
 * A finished agent's transcript, read back from the computer's saved history.
 * Read-only — the process is gone — but a control device can pick the
 * conversation back up in a fresh agent.
 */
export default function StoppedAgentScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { history, repo, label, branch, runner } = useLocalSearchParams<{
    history: string;
    repo: string;
    label?: string;
    branch?: string;
    runner?: string;
  }>();

  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.hasControl());
  const sessions = useAppStore((s) => s.sessionsByRepo[repo ?? ""]);
  const spawnAgent = useAppStore((s) => s.spawnAgent);
  const [resuming, setResuming] = useState(false);

  // Resuming needs somewhere to run: the session still on the agent's branch.
  // Once that worktree is gone there's nothing to resume into.
  const session = (sessions ?? []).find((s) => s.branch === branch);

  const resume = useCallback(() => {
    if (!session || !runner) {
      return;
    }
    setResuming(true);
    spawnAgent(session.id, { resumeSessionId: runner })
      .then((agent) => {
        const name = label?.trim() || `Agent ${agent.agent_id.slice(0, 8)}`;
        router.replace({
          pathname: "/agent/[id]",
          params: { id: agent.agent_id, label: name },
        });
      })
      .catch(() => {
        Alert.alert("Couldn't resume", "The computer refused to start the agent.");
      })
      .finally(() => setResuming(false));
  }, [session, runner, spawnAgent, label, router]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: label ?? "Stopped agent",
          headerRight: () =>
            session ? (
              <HeaderIconBtn
                label="View changes"
                icon={Icons.Branch}
                onPress={() =>
                  router.push({
                    pathname: "/changes/[session]",
                    params: { session: session.id, label: branch ?? "Session" },
                  })
                }
              />
            ) : null,
        }}
      />

      {connection === "offline" && (
        <View style={{ padding: theme.space }}>
          <Banner>Lost the connection to Argus — retrying automatically.</Banner>
        </View>
      )}

      <AgentTranscript agentId={stoppedAgentKey(repo ?? "", history ?? "")} />

      <View
        style={{
          padding: theme.space,
          gap: 6,
          borderTopWidth: 1,
          borderTopColor: theme.border,
        }}
      >
        {hasControl && session && runner ? (
          <Btn
            label={resuming ? "Resuming…" : "Resume in a new agent"}
            disabled={resuming}
            icon={<Icons.Plus size={12} color={theme.text} />}
            onPress={resume}
          />
        ) : (
          <Row gap={6}>
            <Muted>
              {hasControl
                ? "This agent's session is gone, so there's nothing to resume into."
                : "This agent has stopped. Ask the desktop for control to resume it."}
            </Muted>
          </Row>
        )}
      </View>
    </View>
  );
}
