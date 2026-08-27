/**
 * Remote chat input — the phone counterpart of the desktop ChatInput. Sends
 * messages + images, interrupts, switches model / permission mode / effort,
 * links other projects, and offers slash-command and @-mention autocomplete.
 * Rendered only for devices holding the "control" grant (gated by the caller).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { ContextMeter } from "./ContextMeter";
import * as Icons from "./Icons";
import { ImageAttachmentStrip } from "./ImageAttachmentStrip";
import { PickerSheet } from "./PickerSheet";
import {
  Chip,
  IconBtn,
  MONO_FAMILY,
  Muted,
  Row,
  useContentInsets,
  useKeyboardVisible,
} from "./ui";
import { useMentionPicker } from "../hooks/useMentionPicker";
import {
  contextLimitForModel,
  tokensInContext,
} from "../lib/contextWindow";
import { captureImage, pickImages, type PendingImage } from "../lib/images";
import { addImagePasteListener } from "../../modules/argus-paste";
import { buildLinkedProjectsPreamble } from "../lib/linkedProjects";
import type { RemotePermissionMode, RemoteSlashCommand } from "../lib/protocol";
import { readJson, readString, removeKey, writeJson, writeString } from "../lib/storage";
import { useAppStore } from "../stores/appStore";
import { useTheme } from "../theme";

const PERMISSION_MODES: RemotePermissionMode[] = [
  "auto",
  "ask",
  "plan",
  "review",
  "trusted",
];
const PERMISSION_LABELS: Record<RemotePermissionMode, string> = {
  auto: "Auto",
  ask: "Ask",
  plan: "Plan",
  review: "Review",
  trusted: "Trusted",
};

function canonicalMode(mode: string | null | undefined): RemotePermissionMode {
  return mode && (PERMISSION_MODES as string[]).includes(mode)
    ? (mode as RemotePermissionMode)
    : "auto";
}

const draftKey = (agentId: string) => `argus.draft.${agentId}`;
const linkedKey = (agentId: string) => `argus.linked.${agentId}`;

type Picker = "effort" | "mode" | "model" | "project" | null;

export function ChatInput({
  agentId,
  sessionId,
}: {
  agentId: string;
  sessionId?: string;
}) {
  const theme = useTheme();
  const insets = useContentInsets();
  const keyboardVisible = useKeyboardVisible();
  const status = useAppStore((s) => s.statusByAgent[agentId]);
  const caps = useAppStore((s) => s.capabilitiesByAgent[agentId]);
  const effort = useAppStore((s) => s.effortByAgent[agentId] ?? null);
  const messages = useAppStore((s) => s.messagesByAgent[agentId]);
  const loadCapabilities = useAppStore((s) => s.loadCapabilities);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const queueMessage = useAppStore((s) => s.queueMessage);
  const interrupt = useAppStore((s) => s.interrupt);
  const setModel = useAppStore((s) => s.setModel);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setEffort = useAppStore((s) => s.setEffort);
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);

  const inputRef = useRef<TextInput>(null);
  // Previous screens stay mounted in the nav stack, so every ChatInput hears
  // the paste. Only the focused one is the input iOS pasted into.
  const focusedRef = useRef(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  const [picker, setPicker] = useState<Picker>(null);

  const {
    mentionContext,
    items: mentionItems,
    updateMentions,
    selectItem: selectMentionItem,
    dismissMention,
    headerText: mentionHeaderText,
  } = useMentionPicker(sessionId);

  const isRunning = status?.status === "running";
  const mode = canonicalMode(status?.permission_mode);
  const modelValue = status?.model ?? null;
  const models = useMemo(() => caps?.models ?? [], [caps]);
  const commands = useMemo(() => caps?.commands ?? [], [caps]);
  const currentModel = models.find((m) => m.value === modelValue);
  const modelLabel = currentModel?.displayName ?? modelValue ?? "Model";
  const effortLevels = currentModel?.supportsEffort
    ? (currentModel.supportedEffortLevels ?? [])
    : [];

  useEffect(() => {
    loadCapabilities(agentId).catch(() => {});
    loadAgentStatus(agentId).catch(() => {});
  }, [agentId, loadCapabilities, loadAgentStatus]);

  // Restore the persisted draft + linked projects when switching agents.
  useEffect(() => {
    let cancelled = false;
    readString(draftKey(agentId))
      .then((draft) => {
        if (!cancelled) {
          setText(draft ?? "");
        }
      })
      .catch(() => {});
    readJson<string[]>(linkedKey(agentId), [])
      .then((v) => {
        if (!cancelled) {
          setLinked(v);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const onChangeText = useCallback(
    (value: string) => {
      setText(value);
      writeString(draftKey(agentId), value).catch(() => {});
      updateMentions(value, value.length);
    },
    [agentId, updateMentions],
  );

  const onSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      updateMentions(text, e.nativeEvent.selection.start);
    },
    [text, updateMentions],
  );

  const suggestions: RemoteSlashCommand[] = useMemo(() => {
    if (commands.length === 0) {
      return [];
    }
    if (!text.startsWith("/") || text.includes(" ") || text.includes("\n")) {
      return [];
    }
    const q = text.slice(1).toLowerCase();

    return commands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [commands, text]);

  const toggleLinked = useCallback(
    (path: string) => {
      setLinked((prev) => {
        const next = prev.includes(path)
          ? prev.filter((p) => p !== path)
          : [...prev, path];
        writeJson(linkedKey(agentId), next).catch(() => {});

        return next;
      });
    },
    [agentId],
  );

  const addImages = useCallback((next: PendingImage[]) => {
    if (next.length > 0) {
      setPending((prev) => [...prev, ...next]);
    }
  }, []);

  // iOS's own Paste action on the focused input, routed through the native
  // module — React Native's text view drops images otherwise.
  useEffect(
    () =>
      addImagePasteListener((image) => {
        if (!focusedRef.current) {
          return;
        }
        addImages([
          {
            name: "pasted image",
            previewUri: `data:${image.mediaType};base64,${image.data}`,
            attachment: { data: image.data, media_type: image.mediaType },
          },
        ]);
      }),
    [addImages],
  );

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value && pending.length === 0) {
      return;
    }
    const images = pending.length > 0 ? pending.map((p) => p.attachment) : undefined;
    const displayText = value || "(see attached images)";
    const message = buildLinkedProjectsPreamble(linked, displayText);
    // Busy agent → park it on the computer's queue, which the desktop drains
    // when the turn ends. Idle → send straight away.
    if (isRunning) {
      queueMessage(agentId, message, images, displayText).catch(() => {});
    } else {
      sendMessage(agentId, message, images, displayText).catch(() => {});
    }
    setText("");
    setPending([]);
    setLinked([]);
    dismissMention();
    removeKey(draftKey(agentId)).catch(() => {});
    removeKey(linkedKey(agentId)).catch(() => {});
  }, [
    agentId,
    dismissMention,
    isRunning,
    linked,
    pending,
    queueMessage,
    sendMessage,
    text,
  ]);

  const applyMention = useCallback(
    (index: number) => {
      const edit = selectMentionItem(text, index);
      if (!edit) {
        return;
      }
      setText(edit.value);
      writeString(draftKey(agentId), edit.value).catch(() => {});
      inputRef.current?.focus();
    },
    [agentId, selectMentionItem, text],
  );

  const contextTokens = useMemo(() => {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const m = messages![i];
      if (m.role === "assistant" && m.usage) {
        return tokensInContext(m.usage);
      }
    }

    return 0;
  }, [messages]);
  const contextLimit = contextLimitForModel(modelValue, models);

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.bgSecondary,
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: keyboardVisible ? 0 : insets.bottom,
        gap: 8,
      }}
    >
      {suggestions.length > 0 && (
        <Suggestions
          title="Commands"
          rows={suggestions.map((c) => ({
            key: c.name,
            title: `/${c.name}`,
            hint: c.description,
            onPress: () => {
              const next = `/${c.name} `;
              setText(next);
              writeString(draftKey(agentId), next).catch(() => {});
            },
          }))}
        />
      )}

      {mentionContext && suggestions.length === 0 && mentionItems.length > 0 && (
        <Suggestions
          title={mentionHeaderText}
          rows={mentionItems.map((item, i) => ({
            key: `${item.display}-${i}`,
            title: item.isLinkAction ? "Use this directory" : item.display,
            hint: item.isLinkAction ? item.display : item.hint,
            isDir: item.isDir,
            onPress: () => applyMention(i),
          }))}
        />
      )}

      <ImageAttachmentStrip
        items={pending}
        onRemove={(i) => setPending((prev) => prev.filter((_, idx) => idx !== i))}
      />

      <TextInput
        ref={inputRef}
        multiline
        value={text}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
        }}
        placeholder="Message the agent… (/ for commands, @ for files)"
        placeholderTextColor={theme.textMuted}
        style={{
          color: theme.text,
          fontSize: 15,
          maxHeight: 140,
          minHeight: 38,
          paddingVertical: 8,
        }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={6} style={{ paddingBottom: 8 }}>
          {contextTokens > 0 && contextLimit > 0 ? (
            <ContextMeter progress={contextTokens / contextLimit} />
          ) : null}
          {models.length > 0 || modelValue ? (
            <Chip label={modelLabel} mono onPress={() => setPicker("model")} />
          ) : null}
          <Chip
            label={PERMISSION_LABELS[mode]}
            tone={mode === "auto" ? undefined : "accent"}
            onPress={() => setPicker("mode")}
          />
          {effortLevels.length > 0 ? (
            <Chip
              label={effort ?? "Effort"}
              tone={effort ? "accent" : undefined}
              onPress={() => setPicker("effort")}
            />
          ) : null}
          <Chip
            label={linked.length === 0 ? "Link project" : `${linked.length} linked`}
            tone={linked.length > 0 ? "accent" : undefined}
            leading={<Icons.Folder size={11} color={theme.textSecondary} />}
            onPress={() => {
              refreshProjects().catch(() => {});
              setPicker("project");
            }}
          />
        </Row>
      </ScrollView>

      <Row gap={4} style={{ paddingBottom: 6 }}>
        <IconBtn
          label="Attach image"
          onPress={() => {
            pickImages().then(addImages).catch(() => {});
          }}
        >
          <Icons.Paperclip size={17} color={theme.textSecondary} />
        </IconBtn>
        <IconBtn
          label="Take photo"
          onPress={() => {
            captureImage().then(addImages).catch(() => {});
          }}
        >
          <Icons.Camera size={17} color={theme.textSecondary} />
        </IconBtn>
        <View style={{ flex: 1 }} />
        {isRunning && (text.trim() || pending.length > 0) ? (
          <SendButton label="Queue message" onPress={submit} tone={theme.accent} />
        ) : null}
        {isRunning ? (
          <SendButton
            label="Stop agent"
            tone={theme.error}
            onPress={() => interrupt(agentId).catch(() => {})}
            icon={<Icons.Stop size={16} color="#ffffff" />}
          />
        ) : (
          <SendButton label="Send message" onPress={submit} tone={theme.accent} />
        )}
      </Row>

      <PickerSheet
        visible={picker === "model"}
        title="Model"
        current={modelValue}
        empty="Loading models…"
        options={models.map((m) => ({
          value: m.value,
          label: m.displayName,
          hint: m.description,
        }))}
        onSelect={(v) => setModel(agentId, v).catch(() => {})}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === "mode"}
        title="Permission mode"
        current={mode}
        options={PERMISSION_MODES.map((m) => ({
          value: m,
          label: PERMISSION_LABELS[m],
        }))}
        onSelect={(v) =>
          setPermissionMode(agentId, v as RemotePermissionMode).catch(() => {})
        }
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === "effort"}
        title="Reasoning effort"
        current={effort ?? ""}
        options={[
          { value: "", label: "Default" },
          ...effortLevels.map((l) => ({ value: l, label: l })),
        ]}
        onSelect={(v) => setEffort(agentId, v || null).catch(() => {})}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === "project"}
        title="Linked projects"
        multi
        selected={linked}
        empty="No other projects open"
        options={projects.map((p) => ({
          value: p.repo_root,
          label: p.name,
          hint: p.repo_root,
        }))}
        onSelect={toggleLinked}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function SendButton({
  label,
  onPress,
  tone,
  icon,
}: {
  label: string;
  onPress: () => void;
  tone: string;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon ?? <Icons.Send size={17} color="#ffffff" />}
    </Pressable>
  );
}

function Suggestions({
  title,
  rows,
}: {
  title: string;
  rows: {
    key: string;
    title: string;
    hint?: string;
    isDir?: boolean;
    onPress: () => void;
  }[];
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        maxHeight: 190,
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.bgTertiary,
        overflow: "hidden",
      }}
    >
      <View style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
        <Muted style={{ fontSize: 10.5, fontWeight: "700" }}>
          {title.toUpperCase()}
        </Muted>
      </View>
      <ScrollView keyboardShouldPersistTaps="always">
        {rows.map((row) => (
          <Pressable
            key={row.key}
            onPress={row.onPress}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 10,
              paddingVertical: 9,
              borderTopWidth: 1,
              borderTopColor: theme.borderSubtle,
            }}
          >
            {row.isDir != null ? (
              row.isDir ? (
                <Icons.Folder size={13} color={theme.textMuted} />
              ) : (
                <Icons.File size={13} color={theme.textMuted} />
              )
            ) : null}
            <Text
              style={{
                color: theme.text,
                fontSize: 13,
                fontFamily: MONO_FAMILY,
              }}
            >
              {row.title}
            </Text>
            {row.hint ? (
              <Muted numberOfLines={1} style={{ flex: 1 }}>
                {row.hint}
              </Muted>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
