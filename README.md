# TSC Startgeld-Erstattung v2

Erweiterte Version der TSC Startgeld-App mit direkter **manage2sail-Integration**.

## Neue Features (v2)

- 🔍 **manage2sail Suche** - Regatten direkt suchen und Daten automatisch laden
- 📊 **Automatische Platzierung** - Deine Segelnummer wird in den Ergebnissen gefunden
- 👥 **Crew-Import** - Crew-Mitglieder werden automatisch übernommen
- 📄 **PDF Upload** - Weiterhin möglich als Fallback
- ✏️ **Manuelle Eingabe** - Für Regatten ohne manage2sail

## Architektur

```
tsc-startgelder-v2/
├── api/                      # Vercel Serverless Functions
│   ├── search-regatta.js     # Regatta-Suche auf manage2sail
│   └── get-regatta.js        # Details + Ergebnisse laden
├── src/
│   ├── App.jsx               # React Hauptkomponente
│   ├── main.jsx              # Entry Point
│   └── index.css             # Tailwind CSS
├── index.html
├── package.json
├── vercel.json               # Vercel Konfiguration
├── vite.config.js
└── tailwind.config.js
```

## Installation & Deployment

### 1. Repository erstellen

```bash
# Neues Repository auf GitHub erstellen: tsc-startgelder-v2

# Lokal initialisieren
cd tsc-startgelder-v2
git init
git add .
git commit -m "Initial commit: TSC Startgeld v2 mit manage2sail Integration"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/tsc-startgelder-v2.git
git push -u origin main
```

### 2. Bei Vercel deployen

1. Gehe zu [vercel.com](https://vercel.com)
2. "Add New Project"
3. Repository `tsc-startgelder-v2` importieren
4. Framework: **Vite** (sollte automatisch erkannt werden)
5. Deploy!

### 3. Lokale Entwicklung

```bash
npm install
npm run dev
```

**Hinweis:** Die API-Routes funktionieren lokal nur mit `vercel dev`:

```bash
npm install -g vercel
vercel dev
```

## API Endpoints

### `GET /api/search-regatta`

Sucht Regatten auf manage2sail.

**Parameter:**
- `query` (required): Suchbegriff
- `year` (optional): Jahr (default: aktuelles Jahr)

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "slug": "Nikolausregatta2025",
      "name": "42. Nikolausregatta des SVL",
      "year": "2025",
      "fromDate": "06.12.",
      "place": "Markranstädt",
      "url": "https://manage2sail.com/de-DE/event/Nikolausregatta2025"
    }
  ]
}
```

### `GET /api/get-regatta`

Lädt alle Details einer Regatta inkl. Ergebnisse.

**Parameter:**
- `slug` (required): Event-Slug von manage2sail
- `sailNumber` (optional): Segelnummer zum Filtern

**Response:**
```json
{
  "success": true,
  "event": {
    "name": "42. Nikolausregatta",
    "date": "2025-12-06",
    "place": "Markranstädt"
  },
  "classes": [...],
  "participant": {
    "sailNumber": "GER 13162",
    "rank": 5,
    "skipperName": "Max Mustermann",
    "crew": "Anna Musterfrau",
    "club": "TSC Berlin"
  },
  "totalParticipants": 45
}
```

## Unterschiede zu v1

| Feature | v1 | v2 |
|---------|----|----|
| Datenquelle | Nur PDF | manage2sail + PDF |
| Platzierung | PDF-Parser | Automatisch von API |
| Crew | Manuell | Automatisch importiert |
| Server | Statisch | Serverless Functions |
| Hosting | GitHub Pages | Vercel |

## Fallback

Die alte Version bleibt unter der bisherigen URL erreichbar:
- **v1:** https://tsc-startgelder.vercel.app
- **v2:** https://tsc-startgelder-v2.vercel.app (nach Deployment)

## Technologie-Stack

- **Frontend:** React 18, Vite, Tailwind CSS
- **Backend:** Vercel Serverless Functions (Node.js 20)
- **PDF:** pdfjs-dist, pdf-lib, jspdf
- **OCR:** Tesseract.js
- **Datenquelle:** manage2sail.com API

## Lizenz

MIT - Tegeler Segel-Club e.V.
