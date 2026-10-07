const THUMB_MAX = 640

export interface MediaInfo {
  width?: number
  height?: number
  duration?: number
  thumb?: Blob
}

function fit(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function drawToBlob(source: CanvasImageSource, width: number, height: number, type: string, max?: number) {
  const size = max ? fit(width, height, max) : { width, height }
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")
  ctx.drawImage(source, 0, 0, size.width, size.height)
  return canvas.convertToBlob({ type, quality: 0.82 })
}

/** Decodes via an <img> element, which (unlike createImageBitmap) also handles SVG. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.addEventListener("load", () => {
      URL.revokeObjectURL(url)
      resolve(img)
    })
    img.addEventListener("error", () => {
      URL.revokeObjectURL(url)
      reject(new Error("Could not decode image"))
    })
    img.src = url
  })
}

/** An image's pixel size, without the thumbnail `imageInfo` makes. Empty when it can't be decoded. */
export async function imageSize(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    // Never hold up an insert on a decoder that doesn't answer.
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000))
    const { naturalWidth: width, naturalHeight: height } = await Promise.race([loadImage(blob), timeout])
    return width && height ? { width, height } : {}
  } catch {
    return {}
  }
}

export async function imageInfo(blob: Blob): Promise<MediaInfo> {
  try {
    const img = await loadImage(blob)
    const { naturalWidth: width, naturalHeight: height } = img
    // Small images are their own thumbnail; skip the extra copy.
    if (blob.size < 200_000 || !width || !height) return { width, height }
    const thumb = await drawToBlob(img, width, height, "image/webp", THUMB_MAX)
    return { width, height, thumb }
  } catch {
    return {}
  }
}

export function videoInfo(blob: Blob): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement("video")
    const done = (info: MediaInfo) => {
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      video.load()
      resolve(info)
    }
    video.muted = true
    video.preload = "metadata"
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(1, video.duration / 3 || 0)
    })
    video.addEventListener("seeked", async () => {
      const { videoWidth: width, videoHeight: height, duration } = video
      try {
        const thumb = await drawToBlob(video, width, height, "image/webp", THUMB_MAX)
        done({ width, height, duration, thumb })
      } catch {
        done({ width, height, duration })
      }
    })
    video.addEventListener("error", () => done({}))
    video.src = url
  })
}

export function audioInfo(blob: Blob): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    const done = (info: MediaInfo) => {
      URL.revokeObjectURL(url)
      resolve(info)
    }
    audio.preload = "metadata"
    audio.addEventListener("loadedmetadata", () => done({ duration: Number.isFinite(audio.duration) ? audio.duration : undefined }))
    audio.addEventListener("error", () => done({}))
    audio.src = url
  })
}

/** The async clipboard API only accepts PNG images. */
export async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob
  const img = await loadImage(blob)
  return drawToBlob(img, img.naturalWidth, img.naturalHeight, "image/png")
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read blob")),
    )
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read blob")))
    reader.readAsDataURL(blob)
  })
}
