/**
 * Non-secret client preferences (drafts, linked projects, theme). Secrets stay
 * in `expo-secure-store`; this is plain AsyncStorage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export async function readString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writeString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the value is simply not persisted.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readString(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await writeString(key, JSON.stringify(value));
}
