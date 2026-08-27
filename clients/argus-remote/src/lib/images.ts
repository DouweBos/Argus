/**
 * Image attachments: pick from the library or camera and turn the result into
 * base64 `RemoteImageAttachment`s for `agents.send`. Pasted images arrive via
 * the `argus-paste` native module instead, already base64.
 */

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
