# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Yuanbo Yang's personal academic website, hosted at https://freemty.github.io/. Static HTML/CSS site with no build system or package manager — edit files directly and push to deploy via GitHub Pages.

## Branch Structure

- `project_page` — main branch (default remote), serves the live site
- `personal` — personal/development branch
- `master` — legacy branch
- `hugo` — abandoned Hugo migration

## Site Structure

- `index.html` + `stylesheet.css` — Main academic homepage (based on Jon Barron's template). Uses custom HTML elements (`<papertitle>`, `<heading>`, `<name>`) styled in CSS. Research papers use hover-to-reveal video/image pattern with JS toggle functions.
- `fomo/` — "No More FOMO" daily AI news digest. Auto-generated HTML files named by date (`YYYY-MM-DD.html`, `YYYY-MM-DD-zh.html`). Has its own `index.html` archive page with dark/light theme and zh/en language toggle.
- `build/` — Viser 3D viewer client (pre-built React app, do not modify directly)
- `data/` — Media assets (images, videos, PDFs, logos)
- `scripts/` — Python image processing utilities (`ellipse_img.py`, `paddig_img.py`)
- `cc-research-playbook.html`, `steam-steel-infinite-minds.html` — Standalone presentation pages
- `steam-steel-presentation-assets/` — Assets for the presentation page

## Development

No build step. Open HTML files directly in a browser or use any local server:

```bash
python3 -m http.server 8000
```

## Deployment

Push to `project_page` branch — GitHub Pages serves the site automatically.

## Key Patterns

- FOMO digest files are generated externally (by the `no-more-fomo` skill/cron). When updating, follow the existing date-naming convention and update `fomo/index.html` archive entries.
- Adding a new research paper: follow the existing table row pattern in `index.html` — create hover JS functions, add media to `data/`, and update the News section.
- The site uses inline `<table>` layout (not CSS grid/flexbox) for the main page, matching the Jon Barron template style.
