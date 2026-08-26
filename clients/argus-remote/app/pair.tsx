import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import {
  Banner,
  Body,
  Btn,
  Card,
  Muted,
  Row,
  Screen,
  Spinner,
  TextField,
  Title,
} from "../src/components/ui";
import { PairingClient, parsePairingInput } from "../src/lib/pairingClient";
import { useAppStore } from "../src/stores/appStore";
import { useTheme } from "../src/theme";

type Phase = "await-confirm" | "scan";

export default function PairScreen() {
  const theme = useTheme();
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
        onPaired: (identity) => {
          pairComplete(identity)
            .catch(() => {})
            .finally(() => router.replace("/projects"));
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
        <Muted>
          Check this matches the code shown in Argus, then tap “Codes match —
          pair” on your computer.
        </Muted>
        <Card>
          <Body style={{ fontSize: 24, letterSpacing: 4, textAlign: "center" }}>
            {sas}
          </Body>
        </Card>
        <Row gap={8}>
          <Spinner />
          <Muted>Waiting for confirmation…</Muted>
        </Row>
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
      <Title>Pair a computer</Title>
      <Muted>In Argus, open Settings → Remote Access → Start pairing.</Muted>

      {permission?.granted ? (
        <View
          style={{
            height: 280,
            borderRadius: theme.radius,
            overflow: "hidden",
            backgroundColor: theme.mediaBg,
          }}
        >
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => begin(data)}
          />
        </View>
      ) : (
        <Muted>Camera permission is needed to scan the QR.</Muted>
      )}

      <Card>
        <Muted>Or paste the pairing code</Muted>
        <TextField
          multiline
          value={manual}
          onChangeText={setManual}
          placeholder="paste code"
        />
        <Btn label="Pair" disabled={!manual.trim()} onPress={() => begin(manual)} />
      </Card>

      {error && <Banner tone="danger">{error}</Banner>}
    </Screen>
  );
}
