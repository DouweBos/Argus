import { useEffect } from "react";
import { View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Body, Btn, Card, Muted, Screen, Title } from "../src/components/ui";
import { useAppStore } from "../src/stores/appStore";

export default function ProjectsScreen() {
  const router = useRouter();
  const identity = useAppStore((s) => s.identity);
  const loaded = useAppStore((s) => s.loaded);
  const connection = useAppStore((s) => s.connection);
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);

  useEffect(() => {
    if (connection === "ready") {
      refreshProjects().catch(() => {});
    }
  }, [connection, refreshProjects]);

  if (loaded && !identity) {
    return (
      <Screen>
        <Title>Welcome</Title>
        <Muted>Pair this device with Argus on your computer to begin.</Muted>
        <Btn label="Pair a device" onPress={() => router.push("/pair")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Muted>{connectionLabel(connection)}</Muted>
        <Link href="/settings">
          <Muted>Settings</Muted>
        </Link>
      </View>
      {projects.length === 0 ? (
        <Muted>
          {connection === "ready" ? "No projects yet." : "Connecting…"}
        </Muted>
      ) : (
        projects.map((p) => (
          <Card
            key={p.repo_root}
            onPress={() =>
              router.push(`/project/${encodeURIComponent(p.repo_root)}`)
            }
          >
            <Body>{p.name}</Body>
            <Muted>{p.repo_root}</Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}

function connectionLabel(state: string): string {
  switch (state) {
    case "ready":
      return "● Connected";
    case "handshaking":
      return "◐ Securing…";
    case "connecting":
      return "◌ Connecting…";
    default:
      return "○ Offline";
  }
}
