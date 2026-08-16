// Input tamu (mis. nama) yang disuntik ke prompt AI. Murni data — dites di prompt-input.test.ts.
//
// SATU-SATUNYA gerbang antara keyboard fisik di booth dan prompt berbayar. Booth pakai
// keyboard FISIK (keputusan operasional), jadi tamu bisa ngetik karakter apa pun — ga ada
// pembatasan dari perangkatnya. Dua akibat kalau gerbang ini bocor, dua-duanya kejadian
// di event nyata:
//   1. Prompt injection — nilai ini nempel di prompt yang dikirim ke FAL. Token kepotong
//      buat gambar yang bukan pesanan tamu.
//   2. Kata kotor — nilai ini DIRENDER jadi teks di dalam gambar lalu MASUK PRINTER
//      di event klien. Ga ada undo buat kertas yang udah keluar.
// Whitelist, bukan blocklist: apa pun di luar A-Z 0-9 spasi dibuang. Daftar kata kotor
// selalu ketinggalan; batas karakter + panjang enggak.

export const INPUT_MAX_LEN = 12

/** Teks mentah dari keyboard → aman buat ditempel di prompt.
 *  Urutan penting: whitespace diratakan jadi spasi DULU, baru sisanya dibuang —
 *  kalau kebalik, "BUDI\nIGNORE" jadi "BUDIIGNORE" (kata nempel, bukan cuma kepotong). */
export function sanitizeInput(raw: string, maxLen: number = INPUT_MAX_LEN): string {
  const cap = Math.max(0, Math.trunc(maxLen) || 0)
  return raw
    .toUpperCase()
    .replace(/\s+/g, ' ')      // newline/tab → spasi (ratakan dulu, jangan dibuang)
    .replace(/[^A-Z0-9 ]/g, '') // buang sisanya
    .replace(/ {2,}/g, ' ')     // pembuangan di atas bisa ninggalin spasi dobel
    .trim()
    .slice(0, cap)
    .trim()                     // slice bisa mendarat pas di spasi → ujung ga rapi di dalam kutip
}

/** Tempel nilai tamu ke tiap {input} di prompt.
 *  Pakai replacer function, BUKAN string: string replacement nafsirin $& / $1 sebagai pola,
 *  dan hasil substitusi ga boleh dipindai ulang (nilai berisi "{input}" = loop).
 *
 *  Nama itu OPSIONAL — tamu boleh skip. Pas kosong, spasi di DEPAN placeholder ikut dimakan,
 *  jadi `"TOSARI {input}"` keluar `"TOSARI"` bukan `"TOSARI "`. Spasi nyangkut di dalam kutip
 *  itu bagian dari teks yang dibaca model pas ngerender papan nama. */
export function injectPrompt(prompt: string, value: string): string {
  if (value === '') return prompt.replace(/[ \t]*\{input\}/g, '')
  return prompt.replace(/\{input\}/g, () => value)
}

/** Buat validasi sidecar pas sync: operator naro input_field tapi lupa {input} di prompt →
 *  nama tamu ilang diam-diam, tamu tetep diminta ngetik, token tetep kepotong. */
export function hasPlaceholder(prompt: string): boolean {
  return /\{input\}/.test(prompt)
}
