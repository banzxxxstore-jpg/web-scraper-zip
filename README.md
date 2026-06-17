# Web Scraper → ZIP

Scrape seluruh halaman web menjadi file ZIP, dapat di-deploy ke Vercel.

## Struktur Project

```
web-scraper/
├── api/
│   └── scrape.js       ← Serverless function (backend)
├── public/
│   └── index.html      ← Frontend UI
├── vercel.json         ← Konfigurasi routing Vercel
└── package.json
```

## Cara Deploy ke Vercel

### Opsi 1 — Via Vercel CLI (recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Masuk ke folder project
cd web-scraper

# Deploy
vercel

# Ikuti instruksi, pilih:
# - Link to existing project? No
# - Project name: web-scraper-zip (bebas)
# - Root directory: ./  (enter saja)
```

### Opsi 2 — Via GitHub
1. Upload folder ini ke GitHub repo
2. Buka https://vercel.com/new
3. Import repo tersebut
4. Klik Deploy — selesai!

## Cara Pakai

1. Buka URL yang diberikan Vercel setelah deploy
2. Tempel URL halaman web yang ingin di-scrape
3. Pilih aset yang ingin diunduh (HTML, CSS, JS, Gambar, Font)
4. Klik **Scrape**
5. Tunggu proses selesai
6. Klik **Unduh ZIP**

## Isi ZIP yang Dihasilkan

```
scrape_example.com_xxx.zip
├── index.html          ← HTML offline (path asset sudah dipatch)
├── info.txt            ← Log scraping
└── assets/
    ├── css/            ← File stylesheet
    ├── js/             ← File JavaScript
    ├── img/            ← Gambar & ikon
    └── fonts/          ← File font (jika diaktifkan)
```

## Catatan

- Timeout serverless Vercel: 10 detik (hobby plan) / 60 detik (pro plan)
- Situs dengan login / anti-bot tidak dapat di-scrape
- SPA (React/Vue/Next) mungkin perlu waktu lebih lama
- Tidak ada dependency eksternal — hanya Node.js built-in
