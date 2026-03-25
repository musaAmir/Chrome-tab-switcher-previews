# Chrome Web Store Publishing Notes

## Current package status

- Manifest V3 extension with local assets only
- No remote code, analytics, or external network requests
- `declarativeNetRequest` header-stripping flow removed to reduce review risk
- Permissions currently requested: `tabs`, `scripting`, `storage`, and site access on `<all_urls>`

## Why the extension needs site access

- The switcher UI is injected as a content script on normal web pages
- The extension reads tab titles, URLs, and favicons to build the current-window MRU list
- It captures visible-tab screenshots locally to show preview thumbnails
- The optional peek overlay embeds links only on sites that already permit embedding

## Store listing draft

### Summary

Fast keyboard-first tab switching with recent-tab ordering, screenshot previews, and link peek.

### Description

Tab Switcher Previews adds a fast keyboard tab switcher to Chromium-based browsers. It keeps your current window ordered by most recently used tabs so the pages you need are always near the front.

Features:

- Switch through recent tabs with custom shortcuts
- See live screenshot previews for visited tabs
- Keep settings for theme, accent color, and tab count
- Peek supported links in an overlay without leaving the current page
- Fall back to opening a normal tab when a site blocks embedding

Privacy:

- No remote servers
- No analytics
- No ad tracking
- Screenshots and settings stay in Chrome extension storage on your device

### Single-purpose statement

This extension provides a keyboard-driven recent-tab switcher with local screenshot previews and optional in-page link peek.

## Submission checklist

- Add a support email or support site URL in `PRIVACY.md`
- Capture at least one screenshot of the tab switcher UI for the listing
- Capture one screenshot of the options page
- Confirm the icon looks acceptable on a light Chrome Web Store background
- Review the permission justification text in the Chrome Web Store dashboard
- Zip only the extension runtime files, excluding `.git`, `.history`, `.claude`, and `.DS_Store`
- Verify the final package works in a fresh Chrome profile before upload
