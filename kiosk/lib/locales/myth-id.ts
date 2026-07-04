import type { Translations } from './types'
import id from './id'

// Dark Myth (ID) — nada oracle/mistis di 8 judul + subjudul layar.
// Sisanya (tombol, dialog, error, settings, kebijakan privasi) mewarisi `id`.
// Tambah key di sini hanya kalau harus beda dari Bahasa Indonesia biasa.
const mythId: Translations = {
  ...id,

  idle_title: 'Semeta Suites',
  idle_subtitle: 'Sang oracle melihatmu.\nTatap layarnya, biarkan dunia memudar sejenak.\nSentuh cahayanya, raih kebenaran yang tak lekang.',

  consent_title: 'Sumpah Fana ✦',
  consent_subtitle: 'Serahkan wujudmu pada api rahasia.\nTenang — dalam tiga puluh hari, ia binasa.',

  category_title: 'Jalur Visi',
  category_subtitle: 'Semesta melukis ribuan jalan terbentang.\nAlam mana yang ingin kau pandang?',

  template_title: 'Tempaan Takdir',
  template_subtitle: 'Setiap bingkai membawa takdir berbeda.\nPilih yang paling terasa.',

  liveview_title: 'Hadapi Cahayamu ✦',
  liveview_subtitle: 'Berdiri tegak di hadapan cahaya,\ndan melangkahlah ke dalam mimpimu.',

  faceassign_title: 'Sebut Sang Jiwa ✦',
  faceassign_subtitle: 'Banyak yang melangkah, tiap jiwa menyimpan makna.\nSegel mana kau buka, jelma di raut wajahnya.',

  processing_title: 'Menempa Keabadian',
  processing_subtitle: 'Api mistis menyala, roda berputar selaras.\nSabar, sang pejalan — potretmu tengah diukir.',

  preview_title: 'Pilih segel takdirmu ✦',
  preview_subtitle: 'Bingkai mengikat penglihatan.\nKetuk untuk beralih antara bayang dan cahaya.',

  delivery_title: 'Lihatlah.',
  delivery_subtitle: 'Yang pudar dari pandangan, diabadikan cahaya.\nSegel di bawah membawanya keluar dari dinding ini.',
}

export default mythId
