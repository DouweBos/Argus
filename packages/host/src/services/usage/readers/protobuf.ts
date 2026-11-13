/**
 * A schemaless protobuf reader: field number to raw values, enough to pick
 * known fields out of blobs whose `.proto` isn't published.
 */

export type ProtoValue = Uint8Array | number;
export type ProtoFields = Map<number, ProtoValue[]>;

/** Throws on malformed input; callers skip the blob. */
export function decodeProto(bytes: Uint8Array): ProtoFields {
  const out: ProtoFields = new Map();
  let pos = 0;
  const varint = (): number => {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const byte = bytes[pos++];
      if (byte === undefined) {
        throw new Error("truncated varint");
      }
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) {
        return value;
      }
      scale *= 128;
    }
    throw new Error("varint too long");
  };
  const take = (length: number): Uint8Array => {
    if (length > bytes.length - pos) {
      throw new Error("truncated field");
    }
    const value = bytes.subarray(pos, pos + length);
    pos += length;

    return value;
  };
  while (pos < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 0) {
      throw new Error("field 0");
    }
    let value: ProtoValue;
    if (wire === 0) {
      value = varint();
    } else if (wire === 2) {
      value = take(varint());
    } else if (wire === 1 || wire === 5) {
      take(wire === 1 ? 8 : 4);
      continue;
    } else {
      throw new Error(`wire type ${wire}`);
    }
    const list = out.get(field);
    if (list) {
      list.push(value);
    } else {
      out.set(field, [value]);
    }
  }

  return out;
}

export function protoNumber(f: ProtoFields, field: number): number {
  const v = f.get(field)?.[0];

  return typeof v === "number" ? v : 0;
}

export function protoBytes(
  f: ProtoFields,
  field: number,
): Uint8Array | undefined {
  const v = f.get(field)?.[0];

  return v instanceof Uint8Array ? v : undefined;
}

export function protoMessage(f: ProtoFields, field: number): ProtoFields {
  const b = protoBytes(f, field);

  return b ? decodeProto(b) : new Map();
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function protoText(f: ProtoFields, field: number): string {
  const b = protoBytes(f, field);
  if (!b) {
    return "";
  }
  try {
    return utf8.decode(b).trim();
  } catch {
    return "";
  }
}

/** A `google.protobuf.Timestamp` in ms; null when unset. */
export function protoTimestamp(f: ProtoFields): number | null {
  const seconds = protoNumber(f, 1);

  return seconds > 0
    ? seconds * 1000 + Math.floor(protoNumber(f, 2) / 1_000_000)
    : null;
}
