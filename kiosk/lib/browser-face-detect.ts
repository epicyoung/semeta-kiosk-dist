// ponytail: CDN WASM — only loads when both local servers are unreachable

type BBox = { x: number; y: number; w: number; h: number }

const WASM_URL = '/mediapipe/wasm'
const MODEL_URL = '/mediapipe/models/blaze_face_short_range.tflite'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _detector: any = null

export async function browserDetect(imageUrl: string): Promise<BBox[]> {
  if (!_detector) {
    // Init WASM+model dari CDN bisa gagal (offline / CDN down / model ga ke-load). Gagal init =
    // 0 wajah, BUKAN crash — booth tetep jalan, ga ada dev overlay nutupin layar di event.
    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      _detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'IMAGE',
      })
    } catch (err) {
      console.warn('[browser-face-detect] init detector gagal, lanjut 0 wajah:', err)
      return []
    }
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // WAJIB try/catch: detect() bisa lempar (WASM belum ready / gambar korup / OOM). Tanpa ini
      // error naik ke atas → Next.js dev overlay nutupin layar DI EVENT. Gagal deteksi = 0 wajah,
      // BUKAN crash — flow tetep jalan (tamu bisa lanjut, faceswap skip muka yang ga kedetek).
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { detections } = _detector.detect(img) as { detections: any[] }
        resolve(
          detections
            .filter((d: any) => d.boundingBox)
            .map((d: any) => ({
              x: Math.round(d.boundingBox.originX),
              y: Math.round(d.boundingBox.originY),
              w: Math.round(d.boundingBox.width),
              h: Math.round(d.boundingBox.height),
            }))
            .sort((a: BBox, b: BBox) => a.x - b.x)
        )
      } catch (err) {
        console.warn('[browser-face-detect] detect gagal, lanjut 0 wajah:', err)
        resolve([])
      }
    }
    img.onerror = () => resolve([])
    img.src = imageUrl
  })
}
