# spicetify-playlist-columns

A [Spicetify](https://spicetify.app/) extension that adds **Genre**, **Popularity**, and **Plays** columns to playlist views. Toggle which columns are visible, click headers to sort, and restore the original order.

**Sorting owned playlists rewrites track order** (clear + re-add via Spotify’s internal API). Order persists after you leave the playlist. **Date added** is reset for those tracks. Spotify **editorial** playlists (`37i9dQZF1…`) cannot be reordered and show a clear message instead.

## Example

Playlist view with **DJ** (key + BPM), **Genre**, **Popularity**, and **Plays** columns:

![Example: New Dance Pop playlist with custom columns](assets/example.png)

## Features

- Extra columns: Genre, Popularity, Plays (configurable visibility)
- Click column headers to sort ascending / descending / clear
- Sort **your** playlists in place (fast clear + re-add)
- Restore original order before you sorted (session snapshot)
- Settings modal for native column visibility and custom columns
- Works on playlists, Liked Songs, and Local Files views

## Requirements

- [Spicetify](https://spicetify.app/docs/getting-started) 2.x
- `expose_apis = 1` in your Spicetify config
- Spotify desktop client (Windows, macOS, or Linux)

## Install

The extension file is always named **`playlist-columns.js`** in Spicetify’s Extensions folder.

### Windows

1. Install [Spicetify](https://spicetify.app/docs/getting-started) if you have not already.
2. Download [`dist/playlist-columns.js`](dist/playlist-columns.js) from this repo  
   (GitHub: **Code → Download ZIP**, or clone the repository).
3. Copy `playlist-columns.js` into:

   ```
   %appdata%\spicetify\Extensions\
   ```

4. Open **PowerShell** or **Command Prompt** and run:

   ```powershell
   spicetify config extensions playlist-columns.js
   spicetify apply
   ```

5. **Fully quit Spotify** (check the system tray), then reopen it.
6. Open a playlist — you should see a **Columns** button in the action bar.

### Linux

1. Install Spicetify.
2. Copy `dist/playlist-columns.js` to:

   ```
   ~/.config/spicetify/Extensions/
   ```

3. Run:

   ```bash
   spicetify config extensions playlist-columns.js
   spicetify apply
   ```

4. Restart Spotify.

**Arch / unpacked Spotify** (when `spicetify backup apply` fails): use `install-manual.sh` after building or copying `dist/playlist-columns.js`.

### macOS

1. Install Spicetify.
2. Copy `dist/playlist-columns.js` to:

   ```
   ~/.config/spicetify/Extensions/
   ```

   Or, if you use a custom config path: `$SPICETIFY_CONFIG/Extensions/`

3. Run:

   ```bash
   spicetify config extensions playlist-columns.js
   spicetify apply
   ```

4. Restart Spotify.

### Spicetify Marketplace

When listed on the Marketplace, install from **Spotify → Marketplace → Extensions** and search for **Playlist Columns**.

## Usage

1. Open a playlist, Liked Songs, or Local Files.
2. Click **Columns** to choose visible columns.
3. Click **Genre**, **Popularity**, or **Plays** in the header row to sort (▼ desc → ▲ asc → clear).
4. The green **Sorted by …** pill shows the active sort; click it to clear.
5. Click the same header a third time (or clear the pill) to restore the order from before you sorted.

## Sort behavior

| Playlist type | Sort |
|---------------|------|
| Playlists you own / can edit | Reorders tracks in place (persists) |
| Spotify editorial (`37i9dQZF1…`) | Blocked — use **Save to Your Library** and sort the copy |
| Liked Songs / Local Files | Column display works; in-place reorder depends on Spotify permissions |

**Note:** Reordering uses clear + re-add. Track **date added** timestamps are reset. Duplicate tracks in a playlist are preserved in sort order.

## Data sources

| Column     | Source                                         |
|------------|------------------------------------------------|
| Plays      | Spotify metadata `extensionKind: 185`          |
| Popularity | Spotify Web API `/v1/tracks`                   |
| Genre      | Spotify Web API `/v1/artists` (primary artist) |

## Development

Requires Node.js 18+.

```bash
git clone https://github.com/dvize/spicetify-playlist-columns.git
cd spicetify-playlist-columns
npm install
npm run build-local    # minified bundle → dist/playlist-columns.js
npm test
```

```bash
npm run watch          # rebuild on save
spicetify watch -le    # reload Spotify when extension changes
```

## Compatibility

- Spicetify 2.x with `expose_apis = 1`
- May conflict with other extensions that add playlist columns (e.g. Sort Play) — disable overlapping column features if the grid looks wrong

## License

MIT
