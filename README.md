# 中文 Flashcards

A lightweight, offline-capable Chinese language flashcard app built with vanilla HTML, CSS, and JavaScript. No build step required.

## Features

- **Flip animation** — click a card or press `Space` / `Enter` to reveal the Chinese translation
- **Category filter** — browse all cards or focus on one topic
- **Navigation** — `←` / `→` arrow keys or on-screen buttons
- **Shuffle** — randomise the deck order
- **Known / Still learning** — track your progress per session
- **Dynamic import** — paste vocab in the app to add new cards instantly
- **Offline support** — works without internet after first load (PWA)
- **Installable** — add to your phone's home screen via Safari (iOS) or Chrome (Android)

## Project structure

```
chinese-flashcards/
├── index.html          # App shell
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline caching)
├── .gitignore
├── README.md
├── css/
│   └── styles.css      # All styles
├── js/
│   ├── cards.js        # Seed vocabulary data
│   └── app.js          # App logic
└── icons/
    ├── icon-192.png    # PWA icon (192×192)
    └── icon-512.png    # PWA icon (512×512)
```

## Running locally

No install or build step needed — just serve the files over HTTP:

```bash
# Python (built-in)
python3 -m http.server 8000

# Node (if installed)
npx serve .
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

## Deploying to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source to `main` branch, `/ (root)`
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/`

## Installing on your phone (PWA)

### iPhone
1. Open the GitHub Pages URL in **Safari**
2. Tap the **Share** button → **Add to Home Screen**
3. The app installs and launches fullscreen

### Android
1. Open the URL in **Chrome**
2. Tap the **⋮ menu** → **Add to Home Screen**

## Adding vocabulary

Use the **+ Add Vocabulary** panel in the app to paste new words at runtime.
Cards are saved to `localStorage` and persist across sessions.

Paste one word per line in either format:

```
汉字（pīnyīn）    English
汉字    pīnyīn    English
```

To add permanent built-in cards, append entries to `js/cards.js` using the same shape as the existing entries.

## Updating the service worker cache

After deploying changes, bump `CACHE_VERSION` in `sw.js` (e.g. `v1` → `v2`) so users receive the updated files.
