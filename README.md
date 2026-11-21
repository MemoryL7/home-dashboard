# Home Dashboard

An [Obsidian](https://obsidian.md) plugin that provides a "Home" dashboard
view for a personal note-taking vault: quick capture, inbox triage, todo /
day-log / weekly-review panels, note statistics, and an animated garden
background.

## Features

- Home dashboard view that opens automatically at startup
- Quick capture with AI-assisted classification
- Inbox, todo, day-log, longform and weekly-review panels
- Note statistics view
- Animated garden background with rAF-driven sway
- Theme-aware (light / dark) styling via CSS variables

## Install

### From build

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/home-dashboard/` and enable the plugin in
Obsidian's community-plugins settings.

## Development

```bash
npm run dev     # watch build
npm run build   # type-check + production build
npm test        # build + run node:test suite in tests/
```

Source lives in `src/`, with pure logic modules in `src/lib/` covered by
tests in `tests/`.

## License

[MIT](LICENSE)
