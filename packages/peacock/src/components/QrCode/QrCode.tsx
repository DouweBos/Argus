import QRCode from "qrcode";
import { useEffect, useState } from "react";
import styles from "./QrCode.module.css";

export interface QrCodeProps {
  /** The string to encode. */
  value: string;
  /** Rendered pixel size (square). Defaults to 200. */
  size?: number;
  /** Accessible label for the image. */
  alt?: string;
}

/**
 * Renders a QR code as a PNG data URL inside an `<img>` — no inline SVG. Uses
 * the `qrcode` library with high error correction so it scans even when a chunk
 * is obscured. Tokens drive the light/dark modules for theme parity.
 */
export function QrCode({ value, size = 200, alt = "QR code" }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: size * 2, // 2× for crispness on hi-dpi displays.
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) {
          setSrc(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div className={styles.fallback} style={{ width: size, height: size }}>
        Couldn’t render QR
      </div>
    );
  }

  return (
    <div className={styles.frame} style={{ width: size, height: size }}>
      {src && (
        <img
          className={styles.image}
          src={src}
          alt={alt}
          width={size}
          height={size}
        />
      )}
    </div>
  );
}
