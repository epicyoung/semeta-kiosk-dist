import type { Template } from './types'

// ponytail: developer-pinned slot — hardcoded, 
// tidak dari PocketBase, Budi tidak bisa hapus.
export const EPICPIN_ID = '__epicpin__'

export const EPICPIN_TEMPLATE: Template = {
  id: EPICPIN_ID,
  name: 'Spindonesia.com',
  category: 'Spindonesia.com',
  gender_filter: 'ALL',
  engine_type: 'faceswap',
  token_cost: 1,
  thumbnail_url: null,
  positive_prompt: null,
  negative_prompt: null,
  api_endpoint: null,
  video_endpoint: null,
  video_positive_prompt: null,
  video_negative_prompt: null,
}
