import { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { Body, Btn, Card, Muted, Screen, Title } from "../src/components/ui";
import { PairingClient, parsePairingInput } from "../src/lib/pairingClient";
import { theme } from "../src/theme";
import { useAppStore } from "../src/stores/appStore";

type Phase = "scan" | "await-confirm" | "paired";

export default function PairScreen() {
  const router = useRouter();
  const pairComplete = useAppStore((s) => s.pairComplete);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>("scan");
  const [sas, setSas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const clientRef = useRef<PairingClient | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => () => clientRef.current?.cancel(), []);

  const begin = (raw: string) => {
    if (handled.current) {
      return;
    }
    handled.current = true;
    setError(null);
    try {
      const payload = parsePairingInput(raw);
      const client = new PairingClient(payload, {
        onSas: (code) => {
          setSas(code);
          setPhase("await-confirm");
        },
        onPaired: async (identity) => {
          await pairComplete(identity);
          setPhase("paired");
          router.replace("/");
        },
        onError: (message) => {
          setError(message);
          handled.current = false;
          setPhase("scan");
        },
      });
      clientRef.current = client;
      client.start();
    } catch {
      setError("That doesn't look like a valid pairing code.");
      handled.current = false;
    }
  };

  if (phase === "await-confirm") {
    return (
      <Screen>
        <Title>Confirm the code</Title>
        <Muted>Check this matches the code shown in Argus, then tap “Codes match — pair” on your computer.</Muted>
        <View style={styles.sasBox}>
          <Body>{sas}</Body>
        </View>
        <Muted>Waiting for confirmation…</Muted>
        <Btn
          label="Cancel"
          tone="ghost"
          onPress={() => {
            clientRef.current?.cancel();
            handled.current = false;
            setPhase("scan");
            setSas(null);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Pair a device</Title>
      <Muted>In Argus, open Settings → Remote Access → Start pairing.</Muted>

      {permission?.granted ? (
        <Card style={{ padding: 0, overflow: "hidden", height: 280 }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => begin(data)}
          />
        </Card>
      ) : (
        <Muted>Camera permission is needed to scan the QR.</Muted>
      )}

      <Card>
        <Muted>Or paste the pairing code</Muted>
        <TextInput
          style={styles.input}
          placeholder="paste code"
          placeholderTextColor={theme.textMuted}
          value={manual}
          onChangeText={setManual}
          autoCapitalize="none"
          multiline
        />
        <Btn
          label="Pair"
          tone="primary"
          disabled={!manual.trim()}
          onPress={() => begin(manual)}
        />
      </Card>

      {error && <Muted>{error}</Muted>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sasBox: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surfaceRaised,
  },
  input: {
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radiusSm,
    padding: 10,
    minHeight: 60,
  },
});
