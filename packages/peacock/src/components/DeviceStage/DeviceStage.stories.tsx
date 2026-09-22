import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import { DeviceControlOverlay } from "../DeviceControlOverlay/DeviceControlOverlay";
import { DeviceStage, type StreamRotation } from "./DeviceStage";

const FRAME_W = 390;
const FRAME_H = 844;

/**
 * Stand-in for the decoder: paints a portrait "screen" with a marker in the
 * top-left, so a rotated presentation is obvious at a glance.
 */
function useFakeStream(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.fillStyle = "#1c1c1e";
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    ctx.fillStyle = "#0a84ff";
    ctx.fillRect(0, 0, 120, 60);
    ctx.fillStyle = "#ffffff";
    ctx.font = "24px sans-serif";
    ctx.fillText("top-left", 12, 38);
    ctx.strokeStyle = "#48484a";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, FRAME_W - 4, FRAME_H - 4);
  }, [canvasRef]);
}

function Demo({
  rotation,
  blocked,
}: {
  blocked?: boolean;
  rotation: StreamRotation;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [last, setLast] = useState<string>("—");
  useFakeStream(canvasRef);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ height: 420, width: 520, display: "flex" }}>
        <DeviceStage
          blocked={blocked}
          canvasRef={canvasRef}
          rotation={rotation}
          videoHeight={FRAME_H}
          videoWidth={FRAME_W}
          onTouch={(x, y) => setLast(`${x.toFixed(3)}, ${y.toFixed(3)}`)}
        >
          {blocked && (
            <DeviceControlOverlay
              holderLabel="Chris's iPhone"
              onTakeControl={() => undefined}
            />
          )}
        </DeviceStage>
      </div>
      <p style={{ font: "var(--type-caption)", color: "var(--text-muted)" }}>
        Last touch, in the device's own space: {last}
      </p>
    </div>
  );
}

const meta: Meta<typeof DeviceStage> = {
  title: "Components/DeviceStage",
  component: DeviceStage,
  parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof DeviceStage>;

/** Upright: the stream is already the way the device is held. */
export const Portrait: Story = { render: () => <Demo rotation={0} /> };

/** Landscape left: a quarter turn, and touches are un-rotated to match. */
export const LandscapeLeft: Story = { render: () => <Demo rotation={90} /> };

/** Landscape right — the other quarter turn. */
export const LandscapeRight: Story = { render: () => <Demo rotation={270} /> };

/** Upside down: the half turn an iPad in a stand can land in. */
export const UpsideDown: Story = { render: () => <Demo rotation={180} /> };

/** Someone else holds the claim: the picture stays, the pointer is refused. */
export const Blocked: Story = { render: () => <Demo blocked rotation={90} /> };
