import {
  useAndroidVideoDecoder,
  type UseAndroidVideoDecoderResult,
} from "./useAndroidVideoDecoder";

/**
 * WebCodecs H.264 decoder for the iOS/tvOS simulator stream. Thin wrapper over
 * {@link useAndroidVideoDecoder} pointed at the per-UDID `ios_video_*:{udid}`
 * IPC channels — the decode logic is identical. The UDID scoping keeps
 * concurrently-captured devices (e.g. an iPhone and an Apple TV) from
 * multiplexing their H.264 streams into one decoder.
 */
export function useIosVideoDecoder(
  active: boolean,
  udid: string | null,
): UseAndroidVideoDecoderResult {
  return useAndroidVideoDecoder(
    active && !!udid,
    udid ? `ios_video_config:${udid}` : "",
    udid ? `ios_video_frame:${udid}` : "",
  );
}
