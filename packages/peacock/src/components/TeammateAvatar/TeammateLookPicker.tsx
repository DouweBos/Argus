import type {
  TeammateAvatar as TeammateLook,
  TeammateColor,
  TeammateSymbol,
} from "@argus/remote-protocol";
import {
  TEAMMATE_COLORS,
  TEAMMATE_SYMBOLS,
  TeammateAvatar,
} from "./TeammateAvatar";
import avatarStyles from "./TeammateAvatar.module.css";
import styles from "./TeammateLookPicker.module.css";

export interface TeammateLookPickerProps {
  name: string;
  color: TeammateColor;
  avatar: TeammateLook;
  onChange: (look: { color: TeammateColor; avatar: TeammateLook }) => void;
  disabled?: boolean;
}

function lookOf(symbol: TeammateSymbol | null): TeammateLook {
  return symbol ? { kind: "symbol", symbol } : { kind: "initials" };
}

/** A teammate's colour and symbol, from the fixed sets the computer accepts. No symbol shows its initials. */
export function TeammateLookPicker({
  avatar,
  color,
  disabled,
  name,
  onChange,
}: TeammateLookPickerProps) {
  const symbol = avatar.kind === "symbol" ? avatar.symbol : null;

  return (
    <div className={styles.picker}>
      <div aria-label="Colour" className={styles.row} role="radiogroup">
        {TEAMMATE_COLORS.map((option) => (
          <button
            aria-checked={option === color}
            aria-label={option}
            className={[
              styles.swatch,
              avatarStyles[option],
              option === color ? styles.selected : "",
            ].join(" ")}
            disabled={disabled}
            key={option}
            role="radio"
            type="button"
            onClick={() => onChange({ color: option, avatar })}
          />
        ))}
      </div>
      <div aria-label="Symbol" className={styles.row} role="radiogroup">
        {[null, ...TEAMMATE_SYMBOLS].map((option) => (
          <button
            aria-checked={option === symbol}
            aria-label={option ?? "Initials"}
            className={[
              styles.face,
              option === symbol ? styles.selected : "",
            ].join(" ")}
            disabled={disabled}
            key={option ?? "initials"}
            role="radio"
            type="button"
            onClick={() => onChange({ color, avatar: lookOf(option) })}
          >
            <TeammateAvatar
              avatar={lookOf(option)}
              color={color}
              name={name || "?"}
              size={30}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
