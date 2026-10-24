# Raqeeb UI Redesign — Implementation Plan

## 🎯 Goal
Transform the dashboard from its current dark-only, teal-heavy hacker aesthetic into a **clean, professional, Elastic/Kibana-inspired** design with:
- **shadcn-ui / base-ui** design token system
- **Light and dark mode** toggle (light default)
- **Arabic language** support with RTL (English default)
- Style inspired by [raqeeb.khalid-ai.dev](https://raqeeb.khalid-ai.dev/)

> [!IMPORTANT]
> **Zero changes to core JS logic** — navigation routing, API polling, alert system, data rendering, event handlers all stay exactly as-is. Only CSS, HTML structure (cosmetic), and new UI chrome (theme/lang toggles) will change.

---

## Design System

### Color Tokens (shadcn-ui inspired)

| Token | Light | Dark |
|-------|-------|------|
| `--background` | `#f8fafc` | `#0b1120` |
| `--foreground` | `#0f172a` | `#e2e8f0` |
| `--card` | `#ffffff` | `#131c2e` |
| `--card-foreground` | `#0f172a` | `#e2e8f0` |
| `--muted` | `#f1f5f9` | `#1e293b` |
| `--muted-foreground` | `#64748b` | `#94a3b8` |
| `--border` | `#e2e8f0` | `#1e293b` |
| `--primary` | `#0f766e` (teal-700) | `#2dd4bf` (teal-300) |
| `--primary-foreground` | `#ffffff` | `#042f2e` |
| `--destructive` | `#dc2626` | `#f87171` |
| `--accent` | `#f1f5f9` | `#1e293b` |
| `--ring` | `#0f766e` | `#2dd4bf` |

### Severity Colors (work in both modes)
| Severity | Light | Dark |
|----------|-------|------|
| CRITICAL | `#dc2626` | `#f87171` |
| HIGH | `#ea580c` | `#fb923c` |
| MEDIUM | `#d97706` | `#fbbf24` |
| LOW | `#2563eb` | `#60a5fa` |

### Typography
- **Primary font**: `Inter`, system-ui, sans-serif
- **Arabic font**: `IBM Plex Sans Arabic`, `Noto Sans Arabic`, sans-serif
- **Mono**: `IBM Plex Mono`, monospace
- **Headings**: 600 weight, tight tracking
- **Body**: 400–500 weight, relaxed line-height

### Border Radius
- Cards: `12px`
- Buttons/inputs: `8px`
- Badges: `6px`
- Full round (dots, avatars): `9999px`

---

## Implementation Steps

### Phase 1 — CSS Variable System & Theme Toggle
1. Replace all hardcoded colors with CSS custom properties
2. Add `:root` (light) and `[data-theme="dark"]` token definitions
3. Add theme toggle button in the header bar
4. Persist theme choice in `localStorage`

### Phase 2 — Typography & Base Styles
1. Import Inter + IBM Plex Sans Arabic from Google Fonts
2. Update `body`, `h1`, `h2`, table, and form element typography
3. Add `[dir="rtl"]` styles for Arabic layout flips

### Phase 3 — Component Restyling
1. **Sidebar nav** — Clean white/dark card, subtle hover states, no heavy box-shadows
2. **Header bar** — Lighter background, crisp border-bottom, refined search input
3. **Cards** — White bg (light), subtle border, small shadow, no gradients
4. **Badges** — Soft background tint + colored text (shadcn style)
5. **Buttons** — Primary solid, outline variant, ghost variant
6. **Tables** — Clean alternating rows, refined headers
7. **Alert rows** — Left border accent, clean card style
8. **Modals** — Refined overlay, cleaner card with better spacing
9. **Charts/SVGs** — Adapt colors to use theme tokens
10. **Toast notifications** — Bottom-right, clean card style

### Phase 4 — Language System (i18n)
1. Create a `LANG` object with EN/AR translations for all static UI text
2. Add language toggle button (🌐 EN/AR) in the header
3. Toggle `dir="rtl"` and `lang="ar"` on `<html>` element
4. Flip sidebar to right side in RTL mode
5. Persist language choice in `localStorage`

### Phase 5 — Polish & Responsive
1. Smooth transitions for theme/language changes
2. Ensure responsive breakpoints work in both LTR and RTL
3. Verify lockdown/emergency styles in both themes
4. Test all 12 pages render correctly in both modes

---

## Files Modified
- `raqeeb.html` — The single-file SPA (CSS + minimal HTML chrome changes + i18n layer)

## Files NOT Modified
- `server.py`, `raqeeb.py`, `tracktrac.yaml`, `*.pt`, `*.csv`, `*.json`
