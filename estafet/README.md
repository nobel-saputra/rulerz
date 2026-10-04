# Estafet

Chatbot web berbasis OpenRouter. Kalau satu model gratis gagal (penuh, error, atau diam lebih dari 20 detik), pesan otomatis dioper ke model gratis berikutnya.

## Jalankan

```bash
npm install
cp .env.example .env     # lalu isi OPENROUTER_API_KEY
npm start
```

Buka http://localhost:3000

## Cara kerjanya

- Daftar model gratis (`:free`) diambil langsung dari OpenRouter dan di-cache 10 menit, jadi tidak perlu update manual kalau ada model baru atau yang dihapus.
- Urutan: `PREFERRED_MODELS` dulu, lalu sisanya diurutkan dari konteks terbesar.
- Model yang gagal diistirahatkan 2 menit supaya tidak dicoba terus.
- API key hanya ada di server, tidak pernah dikirim ke browser.
- Ada rate limit per IP (default 20 pesan/menit) supaya kuota gratismu tidak habis diborong satu orang.

## Soal "unlimited"

Model gratis OpenRouter punya batas per menit dan per hari. Menurut dokumentasi mereka, akun tanpa saldo dapat jatah harian kecil, dan akun yang pernah top up sedikit mendapat jatah harian jauh lebih besar. Cek angka terbarunya di https://openrouter.ai/docs/api-reference/limits. Fallback antar banyak model membuat peluang gagalnya jauh lebih kecil, tapi bukan tanpa batas.

## Deploy

Pakai hosting yang menjalankan server Node biasa (Render, Railway, Fly.io, atau VPS). Isi `OPENROUTER_API_KEY` lewat environment variable di dashboard hosting. Hindari serverless dengan batas durasi pendek karena jawaban dikirim secara streaming.
