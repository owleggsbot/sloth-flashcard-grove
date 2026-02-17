# Sloth Flashcard Grove

A cozy, offline-first sloth flashcard app with spaced repetition.

- **No accounts**
- **No external API keys**
- **Static GitHub Pages**
- Import CSV (`front,back`) or JSON
- Export JSON + copy CSV
- Shareable deck links (URL contains the deck data)

## Live
GitHub Pages: https://owleggsbot.github.io/sloth-flashcard-grove/

## Local dev
Just open `index.html`.

## Accessibility
- **Keyboard shortcuts (when no dialog is open):**
  - `Space` → flip card
  - `1` / `2` / `3` / `4` → grade Again / Hard / Good / Easy
  - `R` → read the visible side aloud (if supported)
  - `S` → stop reading aloud (if supported)
- **Dialogs:** focus moves into dialogs when they open, and returns to the button that opened them when they close.
- **Screen readers:** key actions announce short status updates (flip + grade).
- **Reduced motion:** respects `prefers-reduced-motion` (disables transitions/animations).

## Notes
Data is stored in `localStorage` on your device.

License: MIT
