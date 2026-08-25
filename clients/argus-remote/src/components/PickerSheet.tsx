/** Bottom-sheet option list — the phone stand-in for the web client's dropdown. */

import { Modal, Pressable, ScrollView, View } from "react-native";
import * as Icons from "./Icons";
import { Body, Muted, Row, SectionHeader } from "./ui";
import { useTheme } from "../theme";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

export function PickerSheet({
  visible,
  title,
  options,
  current,
  multi,
  selected,
  empty,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  current?: string | null;
  /** Multi-select (checkbox) mode — keeps the sheet open on tap. */
  multi?: boolean;
  selected?: string[];
  empty?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
      />
      <View
        style={{
          backgroundColor: theme.bgSecondary,
          borderTopLeftRadius: theme.radius * 1.5,
          borderTopRightRadius: theme.radius * 1.5,
          borderTopWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: theme.space,
          paddingTop: theme.space,
          paddingBottom: theme.space * 2,
          maxHeight: "70%",
        }}
      >
        <Row style={{ justifyContent: "space-between" }}>
          <SectionHeader>{title}</SectionHeader>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icons.Close size={16} color={theme.textMuted} />
          </Pressable>
        </Row>
        <ScrollView style={{ marginTop: 8 }}>
          {options.length === 0 && empty ? <Muted>{empty}</Muted> : null}
          {options.map((o) => {
            const active = multi
              ? (selected ?? []).includes(o.value)
              : o.value === current;

            return (
              <Pressable
                key={o.value}
                onPress={() => {
                  onSelect(o.value);
                  if (!multi) {
                    onClose();
                  }
                }}
                style={{
                  paddingVertical: 11,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.borderSubtle,
                  gap: 2,
                }}
              >
                <Row gap={8}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body>{o.label}</Body>
                    {o.hint ? <Muted numberOfLines={2}>{o.hint}</Muted> : null}
                  </View>
                  {active ? <Icons.Check size={15} color={theme.accent} /> : null}
                </Row>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
