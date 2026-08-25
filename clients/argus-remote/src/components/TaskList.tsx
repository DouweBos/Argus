/** Agent task/todo checklists shown above the transcript. */

import { View } from "react-native";
import * as Icons from "./Icons";
import { Body, Card, Muted, Row, SectionHeader, StatusDot } from "./ui";
import type { RemoteTask, RemoteTodo } from "../lib/protocol";
import { useTheme } from "../theme";

type Status = "completed" | "in_progress" | "pending";

function StatusMark({ status }: { status: Status }) {
  const theme = useTheme();
  if (status === "completed") {
    return <Icons.Check size={13} color={theme.success} />;
  }

  return (
    <StatusDot
      tone={status === "in_progress" ? "accent" : "muted"}
      pulse={status === "in_progress"}
      size={9}
    />
  );
}

export function TaskList({ tasks }: { tasks: RemoteTask[] }) {
  const done = tasks.filter((t) => t.status === "completed").length;

  return (
    <Card>
      <SectionHeader count={tasks.length}>
        Tasks · {done} done
      </SectionHeader>
      <View style={{ gap: 6 }}>
        {tasks.map((t) => (
          <Row key={t.id} gap={8}>
            <StatusMark status={t.status} />
            <View style={{ flex: 1 }}>
              <Body
                numberOfLines={2}
                style={{
                  fontSize: 13.5,
                  textDecorationLine:
                    t.status === "completed" ? "line-through" : "none",
                }}
              >
                {t.status === "in_progress" && t.activeForm
                  ? t.activeForm
                  : t.subject}
              </Body>
              {t.owner ? <Muted>{t.owner}</Muted> : null}
            </View>
          </Row>
        ))}
      </View>
    </Card>
  );
}

export function TodoList({ todos }: { todos: RemoteTodo[] }) {
  const done = todos.filter((t) => t.status === "completed").length;

  return (
    <Card>
      <SectionHeader count={todos.length}>Todos · {done} done</SectionHeader>
      <View style={{ gap: 6 }}>
        {todos.map((t, i) => (
          <Row key={i} gap={8}>
            <StatusMark status={t.status} />
            <Body
              numberOfLines={2}
              style={{
                flex: 1,
                fontSize: 13.5,
                textDecorationLine:
                  t.status === "completed" ? "line-through" : "none",
              }}
            >
              {t.status === "in_progress" && t.activeForm
                ? t.activeForm
                : t.content}
            </Body>
          </Row>
        ))}
      </View>
    </Card>
  );
}
