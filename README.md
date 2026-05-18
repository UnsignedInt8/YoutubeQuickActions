# YouTube Quick Actions

A Tampermonkey userscript that adds **Add to Queue** and **Not Interested** buttons when you hover over a YouTube video thumbnail — no right-clicking or opening the "⋯" menu required.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for Safari (or any other browser).
2. Open Tampermonkey → **Create a new script**.
3. Paste the contents of `youtube-quick-actions.user.js` and save.

## Usage

Hover over any video thumbnail on YouTube. Two buttons appear in the top-left corner of the thumbnail:

| Button | Action |
|--------|--------|
| **+** (queue icon) | Add to queue |
| **✕** (X icon) | Not interested / Hide |

The buttons work on:

- Home feed
- Search results
- Subscriptions feed
- Watch page sidebar (recommended videos)
- Playlist pages

## Notes

- The script clicks the hidden "⋯" context menu on your behalf and selects the relevant item — the menu is invisible while this happens.
- On the Subscriptions page YouTube shows **Hide** instead of **Not Interested**; the script handles both automatically.
- Buttons disappear when you scroll, preventing stale actions on the wrong video.
