import type { Translations } from './types'
import en from './en'

// Dark Myth (EN) — same app, oracle/arcane tone on the 8 screen titles + subtitles.
// Everything else (buttons, dialogs, errors, settings, privacy policy) inherits `en`.
// Add a key here only when it should read differently from plain English.
const mythEn: Translations = {
  ...en,

  idle_title: 'Semeta Suites',
  idle_subtitle: 'The oracle sees you.\nGaze into the glass, let the world fade away.\nTouch the light, and claim a truth that dares to stay.',

  consent_title: "A Mortal's Vow ✦",
  consent_subtitle: 'Offer your visage to the arcane fire.\nFear not — in thirty suns, it shall expire.',

  category_title: 'Path of Visions',
  category_subtitle: 'The cosmos births a thousand ways to see.\nWhich realm of wonder shall yours be?',

  template_title: 'Forge of Destiny',
  template_subtitle: 'Every frame holds a different fate.\nChoose the one that resonates.',
  template_multi_counter: 'bound',


  liveview_title: 'Face the Light ✦',
  liveview_subtitle: "Stand firm before the oracle's gleam,\nand step into the dream.",

  faceassign_title: 'Name the Spirits ✦',
  faceassign_subtitle: 'Many walk the path, yet each must claim their grace.\nChoose which seal to break, and bind them to their face.',

  processing_title: 'Forging the Immortal',
  processing_subtitle: 'The mystic fires burn, the gears align.\nPatience, traveler — your portrait takes design.',
  processing_multi: 'Forging',

  preview_title: 'Choose thy sigil ✦',
  preview_subtitle: 'A border binds the vision.\nTap to wander between shadow and light.',

  delivery_title: 'Behold.',
  delivery_subtitle: 'What fades from sight, the forged light keeps.\nThe seal below carries it beyond these walls.',
}

export default mythEn
