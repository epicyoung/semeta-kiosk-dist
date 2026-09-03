# SEMETA SUITE - Automatic Printer Queue Setup Script (Powershell)

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "    SEMETA SUITE - AUTOMATIC PRINTER QUEUE SETUP FOR 2-STRIP" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1/3] Mencari printer DNP / Photo Printer di PC ini..." -ForegroundColor Yellow

$p = Get-Printer | Where-Object { $_.Name -like '*RX1*' -or $_.DriverName -like '*RX1*' -or $_.Name -like '*DNP*' -or $_.DriverName -like '*DNP*' } | Select-Object -First 1

if (-not $p) {
    $p = Get-Printer | Where-Object { $_.PortName -like 'USB*' -and $_.Name -notlike '*Microsoft*' -and $_.Name -notlike '*Adobe*' } | Select-Object -First 1
}

if (-not $p) {
    Write-Host "[ERROR] Printer DNP / Photo Printer tidak ditemukan!" -ForegroundColor Red
    Write-Host "Pastikan kabel USB printer sudah dicolok ke PC & driver DNP sudah diinstall." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Tekan Enter untuk keluar..."
    exit 1
}

Write-Host ("[OK] Printer Ditemukan : " + $p.Name) -ForegroundColor Green
Write-Host ("     Driver Name      : " + $p.DriverName) -ForegroundColor DarkCyan
Write-Host ("     Port USB Aktif   : " + $p.PortName) -ForegroundColor DarkCyan
Write-Host ""
Write-Host "[2/3] Sync & Membuat Printer Queue RX1-STRIP & RX1-4R..." -ForegroundColor Yellow

try {
    $existingStrip = Get-Printer -Name "RX1-STRIP" -ErrorAction SilentlyContinue
    if (-not $existingStrip) {
        Add-Printer -Name "RX1-STRIP" -DriverName $p.DriverName -PortName $p.PortName -ErrorAction Stop
        Write-Host "[OK] Printer Queue 'RX1-STRIP' berhasil dibuat." -ForegroundColor Green
    } else {
        Set-Printer -Name "RX1-STRIP" -PortName $p.PortName -ErrorAction SilentlyContinue
        Write-Host "[OK] Printer Queue 'RX1-STRIP' sudah ada (port di-sync ke $($p.PortName))." -ForegroundColor Green
    }

    $existing4R = Get-Printer -Name "RX1-4R" -ErrorAction SilentlyContinue
    if (-not $existing4R) {
        Add-Printer -Name "RX1-4R" -DriverName $p.DriverName -PortName $p.PortName -ErrorAction Stop
        Write-Host "[OK] Printer Queue 'RX1-4R' berhasil dibuat." -ForegroundColor Green
    } else {
        Set-Printer -Name "RX1-4R" -PortName $p.PortName -ErrorAction SilentlyContinue
        Write-Host "[OK] Printer Queue 'RX1-4R' sudah ada (port di-sync ke $($p.PortName))." -ForegroundColor Green
    }
} catch {
    Write-Host ("[ERROR] Gagal membuat printer: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host "Pastikan file ini dijalankan dengan Klik Kanan -> 'Run as administrator'!" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Green
Write-Host "      PETUNJUK OPERATOR (LANGKAH TERAKHIR DENGAN 1 KLIK SAJA):" -ForegroundColor Green
Write-Host "===================================================================" -ForegroundColor Green
Write-Host "  1. Jendela 'Printing Preferences RX1-STRIP' akan terbuka otomatis." -ForegroundColor White
Write-Host "  2. Klik Tab: [ Option ] atau [ Advanced ]" -ForegroundColor White
Write-Host "  3. Cari tulisan: [ 2inch Cut ]" -ForegroundColor White
Write-Host "  4. Ubah nilainya menjadi: [ Enable ]" -ForegroundColor White
Write-Host "  5. Klik tombol: [ Apply ] -> lalu [ OK ]" -ForegroundColor White
Write-Host "===================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "[3/3] Membuka jendela Printing Preferences..." -ForegroundColor Yellow

& rundll32.exe printui.dll,PrintUIEntry /e /n "RX1-STRIP"

Write-Host ""
Write-Host "Selesai! Jika sudah di-Enable '2inch Cut', tekan Enter untuk menutup window ini." -ForegroundColor Magenta
Read-Host "Tekan Enter untuk keluar..."

