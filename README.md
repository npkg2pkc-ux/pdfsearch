# PDF Tag Search

Aplikasi web untuk pencarian dokumen PDF berdasarkan **tag / comment / annotation** (sticky note, highlight, dll).

## Quick Start

```bash
npm install
npm start
```

Buka **http://localhost:3000** → klik **"Pilih Folder"** → masukkan path folder PDF.

## Alur Kerja

1. **Pilih Folder** — User input path folder berisi PDF (mis. `D:\MyPDFs`). Tersimpan di database, persisten.
2. **Scan** — Server otomatis scan folder, ekstrak anotasi dari semua PDF, simpan ke SQLite.
3. **Search** — Ketik keyword di search bar. Server cari di tabel anotasi, return daftar file + tag yang cocok.
4. **Detail** — Klik file di sidebar untuk lihat semua anotasi di file tersebut.

## API Endpoints

| Method | Endpoint                | Deskripsi                                |
|--------|-------------------------|------------------------------------------|
| GET    | `/settings`             | Ambil folder aktif                       |
| POST   | `/settings`             | Set folder aktif (body: `active_folder`) |
| POST   | `/scan`                 | Scan folder aktif                        |
| POST   | `/scan?reExtract=true`  | Scan + re-extract semua PDF              |
| POST   | `/upload`               | Upload PDF baru (ke folder aktif)        |
| GET    | `/search?keyword=xxx`   | Cari anotasi                             |
| GET    | `/files`                | Daftar semua file                        |
| GET    | `/files/:id/tags`       | Anotasi satu file                        |
| DELETE | `/files/:id`            | Hapus file dari database                 |

## Struktur Project

```
├── config.js
├── server.js
├── index.html
├── styles.css
├── app.js
├── package.json
├── README.md
├── db/
│   ├── database.js    # Skema + tabel settings
│   └── queries.js     # CRUD + settings helpers
├── services/
│   ├── pdfScanner.js
│   └── pdfExtractor.js
└── uploads/           # Fallback folder
```


## Deploy ke Vercel (Mode Offline / Viewer PDF)

Aplikasi ini juga bisa di-deploy ke Vercel sebagai **static site** — dalam mode
ini hanya fitur **viewer PDF** yang aktif (drag-drop file, lihat di viewer bawaan
browser). Fitur scan/search/upload tidak tersedia di Vercel karena butuh
filesystem & database lokal.

### Cara Deploy

1. Push project ini ke GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/USERNAME/pdf-tag-search.git
   git push -u origin main
   ```

2. Buka https://vercel.com → **New Project** → Import repository dari GitHub.

3. Vercel akan otomatis mendeteksi `vercel.json`. Klik **Deploy**.

4. Setelah deploy selesai, buka URL Vercel (mis. `https://pdf-tag-search.vercel.app`).
   Aplikasi otomatis masuk **Mode Offline** — tinggal drag-drop file PDF.

### Mode Deteksi Otomatis

- Buka di `http://localhost:3000` (setelah `npm start`) → **Mode Online** (fitur lengkap)
- Buka di `file:///...index.html` → **Mode Offline** (viewer saja)
- Buka di Vercel (`https://*.vercel.app`) → **Mode Offline** (viewer saja)

### Catatan Penting untuk Vercel

- Folder `public/pdfjs/` berisi PDF.js library yang sudah di-bundle agar Vercel
  bisa serve tanpa server backend.
- File `server.js` tetap dipertahankan untuk penggunaan **lokal** (tidak hilang).
- Untuk update PDF.js di Vercel, salin ulang dari `node_modules`:
  ```bash
  npm install
  Copy-Item node_modules\pdfjs-dist\build\pdf.min.mjs public\pdfjs\
  Copy-Item node_modules\pdfjs-dist\build\pdf.worker.min.mjs public\pdfjs\
  ```