# Playlist Columns

A [Spicetify Creator](https://spicetify.app/docs/development/spicetify-creator/the-basics) extension that adds **Genre**, **Popularity**, and **Plays** columns to playlist views, with configurable visibility and click-to-sort (session-only, no playlist writes).

## Development setup

Requires Node.js 18+.

```bash
cd ~/.config/spicetify/CustomApps/playlist-columns
npm install
npm run build          # outputs to ~/.config/spicetify/Extensions/playlist-columns.js
```

### Watch mode

```bash
npm run watch          # rebuild on save
spicetify watch -le    # reload Spotify when extension changes (needs working backup)
```

### Local dist build (Marketplace / git)

```bash
npm run build-local    # outputs minified bundle to ./dist/
```

## Project structure

```
src/
  app.tsx              # Extension entry (exports default async function)
  settings.json        # { "nameId": "playlist-columns" }
  css/app.css
  components/SettingsModal.tsx
  lib/                 # metadata, tracklist DOM, sort engine
```

This is an **Extension** ([docs](https://spicetify.app/docs/development/spicetify-creator/create-extensions)), not a Custom App. It does not appear in the sidebar.

## Install

### Arch / broken backup (recommended)

```bash
bash ~/.config/spicetify/CustomApps/playlist-columns/install-manual.sh
```

### Standard (when `spicetify backup apply` works)

```bash
npm run build
spicetify config extensions playlist-columns.js
spicetify apply
```

Restart Spotify.

## Usage

1. Open a playlist, Liked Songs, or Local Files.
2. Click **Columns** to toggle visible columns.
3. Click **Genre**, **Popularity**, or **Plays** headers to sort.
4. Click the green **Sorted by …** pill to clear sort.

## Data sources

| Column     | Source                                           |
|------------|--------------------------------------------------|
| Plays      | Spotify metadata `extensionKind: 185`            |
| Popularity | Spotify Web API `/v1/tracks`                     |
| Genre      | Spotify Web API `/v1/artists` (primary artist)   |

## Compatibility

- Spicetify 2.x with `expose_apis = 1`
- Works alongside DJ Info; disable Sort Play column features to avoid grid conflicts

## License

MIT
