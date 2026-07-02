// ponytail: CDN WASM — only loads when both local servers are unreachable

type BBox = { x: number; y: number; w: number; h: number }

const WASM_URL = '/mediapipe/wasm'
const MODEL_URL = '/mediapipe/models/blaze_face_short_range.tflite'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _detector: any = null

export async function browserDetect(imageUrl: string): Promise<BBox[]> {
  if (!_detector) {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    _detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
    })
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
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
    }
    img.onerror = () => resolve([])
    img.src = imageUrl
  })
}
