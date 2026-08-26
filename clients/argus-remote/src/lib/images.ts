/**
 * Image attachments: pick from the library, the camera, or the clipboard and
 * turn the result into base64 `RemoteImageAttachment`s for `agents.send`.
 */

import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import type { RemoteImageAttachment } from "./protocol";

export interface PendingImage {
  name: string;
  previewUri: string;
  attachment: RemoteImageAttachment;
}

function mediaTypeFor(uri: string, mimeType?: string | null): string {
  if (mimeType) {
    return mimeType;
  }
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

function toPending(asset: ImagePicker.ImagePickerAsset): PendingImage | null {
  if (!asset.base64) {
    return null;
  }

  return {
    name: asset.fileName ?? "image",
    previewUri: asset.uri,
    attachment: {
      data: asset.base64,
      media_type: mediaTypeFor(asset.uri, asset.mimeType),
    },
  };
}

export async function pickImages(): Promise<PendingImage[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return [];
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    base64: true,
    quality: 0.8,
  });
  if (result.canceled) {
    return [];
  }

  return result.assets.map(toPending).filter((x): x is PendingImage => x != null);
}

export async function captureImage(): Promise<PendingImage[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return [];
  }
  const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 });
  if (result.canceled) {
    return [];
  }

  return result.assets.map(toPending).filter((x): x is PendingImage => x != null);
}

/** Whether the clipboard is currently holding an image. */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

/**
 * Pull an image off the clipboard. React Native's `TextInput` has no paste
 * event, so a screenshot copied from anywhere else can only get in through an
 * explicit action rather than ⌘V.
 */
export async function pasteImage(): Promise<PendingImage[]> {
  let image: Clipboard.ClipboardImage | null;
  try {
    image = await Clipboard.getImageAsync({ format: "png" });
  } catch {
    return [];
  }
  if (!image) {
    return [];
  }

  // `data` arrives as a full data URI, but the wire format wants raw base64.
  const base64 = image.data.replace(/^data:image\/\w+;base64,/, "");
  if (!base64) {
    return [];
  }

  return [
    {
      name: "pasted image",
      previewUri: image.data,
      attachment: { data: base64, media_type: "image/png" },
    },
  ];
}
