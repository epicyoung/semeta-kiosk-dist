# Brief: Setup Semeta Photobooth di macOS

**Untuk:** agen/teknisi yang menyiapkan Mac ini dari nol.
**Target:** kiosk photobooth jalan, foto full-res dari Sony ZV-E1, cetak 4R landscape.
**Waktu:** ~30 menit, mayoritas nunggu download.

Mode yang dipakai: **Photo Print (non-AI)**. Tidak ada AI lokal, tidak ada
PocketBase, tidak ada face_server. Cuma Next.js + kamera + printer.

---

## 0. Konteks yang harus dipahami sebelum mulai

Ada **dua jalur kamera**. Jalur A lebih baik; jalur B adalah cadangan yang
dijamin jalan. **Kerjakan Bagian 3 untuk menentukan mana yang dipakai** — jangan
berasumsi jalur A pasti berhasil.

| | Jalur A — gphoto2 | Jalur B — Imaging Edge |
|---|---|---|
| Cara ambil foto | Kiosk trigger shutter sendiri | Operator jepret, file turun ke folder, pilih manual |
| Resolusi | Full-res | Full-res |
| Live view | Tidak ada | Tidak ada |
| Status | **Belum pernah diuji dengan ZV-E1** | Terbukti jalan |

Keduanya full-res. Bedanya cuma otomatis vs manual.

> **Jangan pakai USB Streaming / mode webcam.** Itu cuma 1080p dan bukan yang
> diinginkan. Kamera harus di mode **PC Remote**.

---

## 1. Software yang di-install

Cek dulu apa yang sudah ada — jangan install ulang yang sudah terpasang.

```bash
brew --version
node --version
git --version
```

### Homebrew — kalau `brew --version` gagal

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Setelah selesai, installer mencetak 2-3 baris perintah `eval` untuk menambahkan
brew ke PATH. **Jalankan baris itu** — di Apple Silicon brew ada di
`/opt/homebrew/bin` yang tidak masuk PATH secara default. Verifikasi dengan
`brew --version` sebelum lanjut.

### Sisanya

```bash
brew install node gphoto2
```

- **node** — kiosk butuh Node 20+. Kalau `node --version` sudah ≥20, lewati.
- **gphoto2** — untuk jalur A. Install saja; kalau jalur A gagal, tidak ada ruginya.

### Google Chrome

```bash
brew install --cask google-chrome
```

Lewati kalau `/Applications/Google Chrome.app` sudah ada. Chrome bukan preferensi
— launcher memanggilnya spesifik, dan Safari tidak dipakai.

---

## 2. Ambil kode dan jalankan

```bash
cd ~
git clone https://github.com/epicyoung/semeta-kiosk-dist.git semeta-kiosk
cd semeta-kiosk
chmod +x LAUNCHER-MACOS.command
./LAUNCHER-MACOS.command
```

Run pertama menjalankan `npm install` (beberapa menit). Chrome akan terbuka
fullscreen di `localhost:3000`.

**`npm install` mungkin mengeluarkan warning soal paket `pdf-to-printer`** —
itu paket Windows-only. Abaikan selama proses tetap selesai; di macOS jalur
cetaknya memang berbeda (lihat Bagian 5). Kalau `npm install` benar-benar
*gagal* (bukan sekadar warning), catat pesannya dan lapor.

Tutup kiosk: `Ctrl+C` di jendela Terminal tempat launcher jalan.

---

## 3. Tentukan jalur kamera — LANGKAH PENENTU

### 3a. Siapkan kamera

Di ZV-E1: **Menu → Setup → USB → USB Connection Mode → PC Remote**

Colok USB-C ke Mac. Nyalakan kamera.

### 3b. Bersihkan perebut USB

macOS punya proses bernama `PTPCamera` yang otomatis mengambil alih kamera saat
dicolok. Ini penyebab kegagalan nomor satu.

```bash
killall PTPCamera 2>/dev/null
```

Tutup juga **Photos.app** dan **Imaging Edge** kalau terbuka. Photos suka
auto-launch saat kamera dicolok — matikan lewat Photos → Settings → General →
uncheck opsi buka otomatis.

### 3c. Tes deteksi

```bash
gphoto2 --auto-detect
```

**Kalau ZV-E1 muncul di daftar**, lanjut tes jepret:

```bash
cd /tmp && gphoto2 --capture-image-and-download --filename test.jpg
```

Berhasil kalau `test.jpg` muncul dan ukurannya besar (beberapa MB). Cek:

```bash
ls -lh /tmp/test.jpg
```

→ **Jalur A dipakai.** Lanjut ke Bagian 4a.

**Kalau gagal** (kamera tidak terdeteksi, atau capture error) — jangan buang
waktu ngoprek. **Catat pesan errornya lengkap**, lalu pakai Jalur B di Bagian 4b.

Error `-53: Could not claim the USB device` artinya masih ada yang memegang USB.
Ulangi 3b, coba sekali lagi. Kalau tetap gagal setelah dua kali, pindah ke jalur B.

---

## 4. Konfigurasi kiosk

Buka Settings di kiosk lewat ikon gear.

Apa pun jalurnya, set dulu: **Engine Mode → Photo Print (non-AI)**

### 4a. Jalur A (gphoto2 berhasil)

**Settings → Camera Source → `Sony (gphoto2, no live view)`**

Selesai. Tombol Capture di kiosk akan memicu shutter kamera dan menarik file
full-res langsung. Layar preview menampilkan panel info, bukan live view — itu
memang begitu, bukan kerusakan. Framing dilakukan lewat LCD kamera.

### 4b. Jalur B (pakai Imaging Edge)

1. Download **Imaging Edge Desktop** dari situs resmi Sony (gratis, cari
   "Sony Imaging Edge Desktop"). Modul yang dipakai bernama **Remote**.
2. Buka Imaging Edge Remote, sambungkan kamera (tetap mode PC Remote).
3. Set folder simpan ke `~/semeta/masuk` — buat dulu foldernya:
   ```bash
   mkdir -p ~/semeta/masuk
   ```
4. Di kiosk: **Settings → Camera Source → `Webcam (getUserMedia)`**

Alurnya: operator jepret (dari kamera atau dari Imaging Edge) → file turun ke
`~/semeta/masuk` → di kiosk tekan tombol **Browse** → pilih file terbaru.

Tombol Browse selalu muncul, tidak bergantung camera source.

---

## 5. Printer — bagian paling berisiko, jangan dilewati

Pasang printer di macOS seperti biasa (System Settings → Printers & Scanners).

**Jalur cetak di macOS berbeda dari Windows.** Di Windows kiosk mencetak diam-diam
lewat antrian yang sudah di-preset. Di macOS itu tidak tersedia, jadi yang muncul
adalah **dialog print standar** dan operator menekan Print. Ini disengaja, bukan bug.

### Wajib: tes cetak sungguhan

Jangan anggap selesai tanpa ini.

1. Jalankan kiosk, ambil satu foto sampai layar Preview
2. Tekan Print
3. Di dialog: pilih printer, **paper size 4R / 4×6 inch**, orientasi **landscape**
4. Cetak di kertas asli
5. **Periksa hasilnya**: apakah foto terpotong di tepi? Ada border putih tebal?

Kalau sizing meleset, atur di dialog print: cari opsi **Scale to Fit** atau
sesuaikan margin. Catat setelan yang benar supaya operator tidak mengulang
percobaan saat acara.

Sisihkan 2-3 lembar kertas untuk ini. Lebih murah dibanding salah cetak saat acara.

---

## 6. Checklist serah-terima

Tandai satu per satu. Jangan laporkan selesai kalau ada yang belum:

- [ ] `brew`, `node --version` (≥20), `git` — semua merespons
- [ ] Repo ter-clone di `~/semeta-kiosk`
- [ ] `./LAUNCHER-MACOS.command` membuka Chrome fullscreen di localhost:3000
- [ ] Engine Mode = **Photo Print (non-AI)**
- [ ] Camera source diset sesuai jalur yang terbukti di Bagian 3
- [ ] Satu foto berhasil masuk ke kiosk dari kamera
- [ ] Foto tembus sampai layar Preview, frame ter-composite
- [ ] **Satu cetakan 4R sungguhan sudah keluar dan sizing-nya benar**
- [ ] Ctrl+C menutup kiosk dengan bersih; jalankan ulang masih berfungsi

---

## 7. Yang dilaporkan balik

Tulis singkat:

1. **Jalur kamera mana yang dipakai** — A atau B, dan kalau A gagal, pesan
   error `gphoto2 --auto-detect` selengkapnya
2. **Hasil tes cetak** — sizing langsung benar, atau butuh setelan tertentu di
   dialog (sebutkan apa)
3. **Kejanggalan lain** yang ditemui

---

## Lampiran: troubleshooting

| Gejala | Sebab & tindakan |
|---|---|
| `Could not claim the USB device` / `-53` | Proses lain memegang USB. `killall PTPCamera`, tutup Photos & Imaging Edge, ulangi. |
| `Could not find the requested device` | Kamera tidak di mode PC Remote, atau kabel data bermasalah. Cek menu USB kamera; sebagian kabel USB-C hanya bisa charge. |
| `bad interpreter: No such file or directory` saat jalankan launcher | Line ending rusak. Perbaiki: `sed -i '' 's/\r$//' LAUNCHER-MACOS.command` |
| Chrome buka tapi halaman error | Server belum siap atau port bentrok. Ctrl+C, jalankan ulang launcher. |
| Port 3000 dipakai | Launcher sudah membersihkan otomatis. Kalau tetap: `lsof -ti tcp:3000 \| xargs kill -9` |
| Layar preview hitam/kosong di mode Sony | **Normal.** PC Remote tidak menyediakan live view. Framing lewat LCD kamera. |
| Kiosk menampilkan pesan error saat Capture | Pesannya sudah berisi instruksi konkret — ikuti. Umumnya `killall PTPCamera`. |
