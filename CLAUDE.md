# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Yuanbo Yang's personal academic website, hosted at https://freemty.github.io/. Static HTML/CSS site with no build system or package manager — edit files directly and push to deploy via GitHub Pages.

## Branch Structure

- `project_page` — main branch (default remote), serves the live site
- `personal` — personal/development branch
- `master` — legacy branch

## Design System

The site uses the **Swiss Knife Design System** (`/swiss-knife-design` skill). Key principles:

- **Color**: Pure black `#000` + pure white `#FFF` + Swiss Army Knife Red `#C6011F` (same in dark mode)
- **Red is line, not text** — accent only on borders, bars, badges, and hover states
- **Dormant → Alive** — images/logos start faded (light: brightened; dark: darkened), restore on hover
- **Typography**: EB Garamond (display) + Inter (body)
- **Layout**: Flexbox, max-width 860px, no table layouts
- **Dark mode**: `data-theme="dark"` on `<html>`, respects system preference + localStorage
- **Accessibility**: `:focus-visible` outline on all interactive elements; `scroll-margin-top` on sections for fixed nav; mobile breakpoints restore image saturation (no hover on touch)

## Site Structure

- `index.html` + `stylesheet.css` — Main academic homepage. Modern card-based layout with nav, hero, news, research papers (highlight/expand system), experience timeline, and dark mode toggle.
- `fomo/` — "No More FOMO" daily AI news digest. Auto-generated HTML files named by date (`YYYY-MM-DD.html`, `YYYY-MM-DD-zh.html`). Has its own `index.html` archive page with dark/light theme and zh/en language toggle.
- `build/` — Viser 3D viewer client (pre-built React app, do not modify directly)
- `data/` — Media assets (images, videos, PDFs, logos)
- `data/Yuanbo_CV.tex` + `data/Yuanbo_CV.pdf` — LaTeX CV source and compiled PDF. Uses Swiss Knife Red accent on section rules. Compile with `pdflatex data/Yuanbo_CV.tex` (run twice for refs).
- `data/logo/` — Institution logos (padded PNGs: ant, zju, hdu, ucsd, umich, analamma)
- `scripts/` — Python image processing utilities
- `cc-research-playbook.html`, `steam-steel-infinite-minds.html` — Standalone presentation pages

## Development

No build step. Open HTML files directly in a browser or use any local server:

```bash
python3 -m http.server 8000
```

## Deployment

Push to `project_page` branch — GitHub Pages serves the site automatically.

## Key Patterns

- **Adding a new paper**: Add an `<article class="paper-card">` inside `.papers`. Use `class="highlight"` for first-author papers (shown by default). Others are hidden until "Show all" is clicked.
- **Paper media**: Include `<div class="paper-media">` with `<img>` and optional `<video>`. Images auto-desaturate and restore on hover.
- **News items**: Add a `<div class="news-item">` with `.news-date` and `.news-text` spans.
- **Experience entries**: Add a `<div class="timeline-item">` with logo + info.
- **FOMO digest**: Generated externally by the `no-more-fomo` skill/cron. Follow date-naming convention.
- **Dark mode**: Handled via CSS variables + `[data-theme="dark"]` selectors. JS toggles the attribute and saves to localStorage.
- **Updating CV**: Edit `data/Yuanbo_CV.tex`, run `pdflatex` twice, commit both `.tex` and `.pdf`. Keep content in sync with `index.html` (papers, experience, bio).
