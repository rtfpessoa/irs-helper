# Offline Support Implementation

This document explains how the IRS Helper application works without an internet connection.

## Overview

The application now includes comprehensive offline support through:
1. **Service Worker** - Caches all application assets and libraries
2. **Progressive Web App (PWA) manifest** - Makes the app installable
3. **Smart caching strategies** - Ensures all necessary files are available offline

## How It Works

### First Load (with internet)
1. When the user first loads the application, the browser downloads all necessary files
2. In production builds, the service worker (from `/service-worker.js`) intercepts network requests
3. Successfully loaded files matching cacheable patterns are automatically cached:
   - JavaScript files (`.js`, including module bundles)
   - Stylesheets (`.css`)
   - Locale files (`.json`)
   - Images and icons (`.svg`, `.png`, `.jpg`, etc.)
   - Font files (`.woff2`, `.ttf`, etc.)
   - PDF.js worker file (`/assets/pdf.worker.js`)

### Subsequent Loads & Offline Use
1. **Cache-First Strategy**: The service worker serves files from cache when available
2. **Network Fallback**: If a file isn't cached and there's no internet, the app displays the cached version
3. **Automatic Updates**: When online, new versions of files are cached for offline use

### What's Cached
- ✅ All React components and application code
- ✅ i18next locale files (English and Portuguese translations)
- ✅ All icons (Lucide, React Icons)
- ✅ PDF.js library and worker for PDF processing
- ✅ Styling and CSS files
- ✅ Application manifest

### Key Features

**Service Worker (`src/serviceWorker.ts`)**
- Automatically caches files on install
- Updates cache when files change
- Serves from cache first, with network fallback
- Handles PDF processing with cached PDF.js library
- Cleans up old cache versions

**PWA Manifest (`public/manifest.json`)**
- Makes the app installable on mobile and desktop
- Sets dark/light theme support
- Defines app shortcuts and capabilities

**Registration (`src/main.tsx`)**
- Service worker is registered once, after page load
- Registration runs only in production (`import.meta.env.PROD`)
- Registration path is `/service-worker.js` with scope `/`
- This avoids localhost MIME errors during Vite development

**Manifest loading (`index.html`)**
- Manifest is loaded as `/manifest.json` with `crossorigin="use-credentials"`
- This supports protected preview environments that require credentials

## Testing Offline Functionality

### In Development
1. Run `npm run dev` to start the development server
2. Service worker is intentionally not registered in dev mode
3. No offline caching behavior is expected in `npm run dev`
4. Use a production build to validate offline behavior

### In Production
1. Build with `npm run build`
2. Serve the `dist/` folder locally or deploy
3. First load must be online to cache all files
4. After first load, the app works offline from cache
5. Confirm in DevTools > Application > Service Workers that `/service-worker.js` is active

## Installation as PWA

### Desktop (Chrome/Edge)
1. Load the app in your browser
2. Click the "Install" button (usually in the URL bar)
3. The app opens in a standalone window with offline support

### Mobile (Chrome/Android)
1. Load the app in Chrome
2. Tap the menu > "Install app"
3. The app appears as an installable app

### Manual Installation
- Open the app
- Add to home screen (mobile) or bookmark (desktop)
- The service worker ensures it works offline

## File Structure

```
src/
├── serviceWorker.ts        # Service worker with caching logic
├── main.tsx                # Registration of service worker
└── ...

public/
├── manifest.json           # PWA manifest
└── ...

dist/
├── service-worker.js       # Compiled service worker (root scope)
├── assets/
│   ├── main-*.js           # App bundle
│   ├── main-*.css          # Styles
│   └── pdf.worker.js       # Stable PDF.js worker filename
└── index.html
```

## Cache Invalidation

When you need to force users to get new versions:
1. Increment `CACHE_NAME` in `src/serviceWorker.ts` (e.g., `'irs-helper-v4'` -> `'irs-helper-v5'`)
2. Rebuild the project: `npm run build`
3. Deploy to production
4. The service worker will automatically clean up old caches

## Browser Support

- ✅ Chrome/Edge 40+
- ✅ Firefox 44+
- ✅ Safari 11.1+ (limited service worker support)
- ✅ Modern mobile browsers

## Performance Impact

- **First Load**: Initial service worker registration (~2KB) slightly increases first load time
- **Subsequent Loads**: Faster due to cached assets
- **Offline Mode**: Instant loading from cache
- **Cache Size**: ~5-10MB depending on usage (includes all dependencies)

## Troubleshooting

### Service Worker not registering
- Check browser DevTools > Application > Service Workers
- Verify the app is served over HTTPS (or localhost)
- Check console for error messages
- Ensure the script URL is `/service-worker.js` (not under `/assets/`)
- In dev mode (`npm run dev`), registration is intentionally skipped

### Manifest fetch failed (401)
- If running in a protected preview environment, keep:
   `<link rel="manifest" href="/manifest.json" crossorigin="use-credentials" />`
- Verify your preview auth/session is active in the browser

### App not working offline
- First load must be completely online to cache all files
- Wait for "Service Worker registered successfully" message in console
- Check Network tab in DevTools to see what's being cached
- Verify `/assets/pdf.worker.js` is reachable and cached

### Cache seems outdated
- Force refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
- Or delete the service worker and reload
- Or update `CACHE_NAME` in `src/serviceWorker.ts` to force cache refresh

## Future Enhancements

Possible improvements:
- [ ] Background sync for form submissions
- [ ] Periodic cache updates
- [ ] IndexedDB for larger file storage
- [ ] Push notifications for cache updates
