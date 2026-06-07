# gogexmd

Secure local Markdown importer for X Articles.

## What It Does

- Imports `.md` / `.markdown` files into the X Article editor.
- Reads Markdown from clipboard after a user click.
- Extracts title from frontmatter `title` or the first `# H1`.
- Converts common Markdown syntax to safe HTML.
- Previews sanitized content before import.
- Falls back to copying sanitized HTML/plain text when automatic paste fails.

## Security Choices

- No X bearer token.
- No private X API calls.
- No automatic publishing.
- No `activeTab` or `scripting` permission.
- HTML tag allowlist.
- URL protocol filtering.
- Images only allow `https://`.
- Remember-last-content is off by default and expires after 24 hours.

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click "Load unpacked".
4. Select this folder: `/Users/mars/Desktop/gogexmd`.

Use it only after manually opening an X Article compose page.
