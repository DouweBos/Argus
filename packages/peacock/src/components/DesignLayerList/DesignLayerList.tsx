import { ColorSwatch } from "../ColorSwatch/ColorSwatch";
import styles from "./DesignLayerList.module.css";

/** One layer of a design frame, flattened in drawing order. */
export interface DesignLayerItem {
  depth: number;
  /** `#rrggbb`. */
  fill: string | null;
  /** `Inter 600 16/24`. */
  font: string | null;
  height: number | null;
  id: string;
  name: string;
  text: string | null;
  type: string;
  width: number | null;
}

export interface DesignLayerListProps {
  layers: DesignLayerItem[];
  /** Depth levels deeper than this stop indenting further. */
  maxIndent?: number;
}

const INDENT_CLASSES = [
  styles.d0,
  styles.d1,
  styles.d2,
  styles.d3,
  styles.d4,
  styles.d5,
  styles.d6,
  styles.d7,
];

function size(layer: DesignLayerItem): string | null {
  if (layer.width === null || layer.height === null) {
    return null;
  }

  return `${Math.round(layer.width)}×${Math.round(layer.height)}`;
}

/** A frame's layer tree as an indented list: name, size, fill, font and text. */
export function DesignLayerList({
  layers,
  maxIndent = INDENT_CLASSES.length - 1,
}: DesignLayerListProps) {
  return (
    <ul className={styles.list}>
      {layers.map((layer) => {
        const depth = Math.min(
          Math.max(0, layer.depth),
          maxIndent,
          INDENT_CLASSES.length - 1,
        );
        const dims = size(layer);

        return (
          <li
            key={layer.id}
            className={`${styles.row} ${INDENT_CLASSES[depth]}`}
          >
            <div className={styles.head}>
              <span className={styles.type}>{layer.type.toLowerCase()}</span>
              <span className={styles.name} title={layer.name}>
                {layer.name}
              </span>
              {dims && <span className={styles.dims}>{dims}</span>}
            </div>
            {(layer.fill || layer.font) && (
              <div className={styles.meta}>
                {layer.fill && <ColorSwatch color={layer.fill} />}
                {layer.font && (
                  <span className={styles.font}>{layer.font}</span>
                )}
              </div>
            )}
            {layer.text && <p className={styles.text}>{layer.text}</p>}
          </li>
        );
      })}
    </ul>
  );
}
