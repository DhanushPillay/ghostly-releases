import { desktopCapturer, screen } from "electron";

export async function captureFullScreen(): Promise<string> {
  // The screen the user is actually looking at, not necessarily Windows' designated
  // "primary" monitor. This used to always capture getPrimaryDisplay() and always take
  // sources[0] regardless of how many screens desktopCapturer returned — on any
  // multi-monitor setup where the interview/assessment window was on a secondary
  // display, every single screenshot silently captured the wrong (often blank or
  // unrelated) screen, which the AI then correctly reports as "Nothing actionable -
  // screenshot not visible" since there genuinely was no question on what it saw.
  const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = activeDisplay.size;

  // 1600px is what the renderer sends to the AI (imageCompressor's default), so
  // capture at that size directly instead of grabbing 2560px, JPEG-encoding it,
  // shipping ~1MB over IPC, and then downscaling it again in the renderer — the
  // extra capture/encode/transfer work only added latency to every screenshot.
  const MAX_WIDTH = 1600;
  const targetWidth = Math.min(width, MAX_WIDTH);
  const targetHeight = Math.round((targetWidth / width) * height);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: targetWidth,
      height: targetHeight,
    },
  });

  if (sources.length === 0) {
    throw new Error("No screen source found");
  }

  // Match the source to the active display by its display_id (desktopCapturer's one
  // property that ties a capture source back to a specific electron `screen` display).
  // Falls back to the first source if a single-screen setup leaves it unset/unmatched.
  const match = sources.find((s) => s.display_id && String(activeDisplay.id) === s.display_id);
  const source = match ?? sources[0];

  // 85% JPEG keeps code/text crisp for vision models at a much smaller payload.
  const jpegBuffer = source.thumbnail.toJPEG(85);
  return `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
}
