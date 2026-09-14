# Quest Terminal

A fully static (serverless) web app for NFC-driven quests. Open it on an
Android phone in Chrome, tap an NFC tag, and depending on the tag's content
the app shows a text/image reveal — or a terminal-style code prompt that
must be solved to unlock the next clue.

No backend, no database, no build step. Just static files you can host on
GitHub Pages, Netlify, Cloudflare Pages, or any static HTTPS host.

## Requirements

- **Android phone with NFC**, using **Google Chrome** (Web NFC is not
  supported on iOS, desktop browsers, or other Android browsers).
- The site must be served over **HTTPS** (or `http://localhost` during
  local testing) — Web NFC and the crypto APIs used here both require a
  secure context.
- Blank writable **NFC tags** (NTAG213/215/216 stickers/cards are cheap and
  common) and an app to write them, e.g. "NFC Tools" from the Play Store.

## How it works

1. `config.json` maps a **tag key** (a short text string you choose, e.g.
   `relic-01`) to either:
   - a **reveal** entry: a title, multi-line text, and optional images, or
   - a **code** entry: a terminal-style prompt that checks the player's
     input against a hash, then reveals a success text/images.
2. Each physical NFC tag is written with a single **NDEF Text record**
   containing that tag key.
3. When the phone taps the tag, the app reads the text, looks it up in
   `config.json`, and renders the matching screen.
4. If no tag scanned yet, the app shows `idleText` from the config.
5. Unknown tags (not present in the config) show `unknownTagText`.

## Codes are never stored in plain text

Secret codes are **not** written into `config.json` or any JS file as
plain text. Instead you store a **salted SHA-256 hash**. When the player
submits a guess, the app salts + hashes it client-side with the Web Crypto
API and compares the result to the stored hash. Viewing the page source or
`config.json` only reveals the hash, never the code.

> Note: this protects the code from casual inspection of the site (the
> stated requirement), but a hash is not a secret vault — someone who
> really wants to could brute-force short/common codes offline. Pick codes
> that aren't trivial dictionary words if that matters for your quest.

Generate a hash without any server:

1. Open [`tools/hash-generator.html`](tools/hash-generator.html) directly
   in a browser (double-click it, or serve it — no network calls happen).
2. Enter a **salt** (any random string, unique per tag) and the **plain
   code**.
3. Click `GENERATE HASH`, then copy the `salt` and `codeHash` values into
   the corresponding tag entry in `config.json`.

## Configuring `config.json`

```json
{
  "appTitle": "QUEST TERMINAL",
  "idleText": "Shown on the home screen before any tag is scanned.",
  "unknownTagText": "Shown when a scanned tag isn't in the config.",
  "unsupportedText": "Shown on browsers without Web NFC support.",
  "tags": {
    "relic-01": {
      "type": "reveal",
      "title": "THE FIRST RELIC",
      "text": "Any multi-line clue text.\nUse \\n for line breaks.",
      "images": ["images/relic-01.jpg"]
    },
    "vault-02": {
      "type": "code",
      "title": "SEALED VAULT",
      "prompt": "ENTER ACCESS CODE",
      "salt": "vault-02-salt-9f2a",
      "codeHash": "<generated hash>",
      "maxAttempts": 0,
      "failText": "ACCESS DENIED. TRY AGAIN.",
      "successTitle": "ACCESS GRANTED",
      "successText": "Text shown once the correct code is entered.",
      "successImages": []
    }
  }
}
```

Field notes:

- `type`: `"reveal"` or `"code"`.
- `images` / `successImages`: arrays of paths (put files in `images/`).
- `maxAttempts`: `0` = unlimited; any positive number locks the code
  screen after that many wrong guesses (until the tag is scanned again).

## Writing the NFC tags

1. Install **NFC Tools** (or similar) on an Android phone.
2. Choose "Write" → "Add a record" → **Text**.
3. Enter the exact tag key from `config.json` (e.g. `relic-01`), all
   lowercase, no extra spaces.
4. Tap "Write" and hold the phone against the physical tag.
5. Repeat for every tag key you defined.

## Local testing (important!)

Do **not** open `index.html` by double-clicking it (a `file://` URL). Browsers
block `fetch()` of local files under `file://`, so `config.json` will fail to
load with an error like `CONFIG LOAD ERROR: Failed to fetch`. You must serve
the folder over `http://` (or `https://`) — this is also a requirement for
Web NFC itself.

Easiest option with Node.js installed:

```
npx http-server . -p 8080
```

then open `http://localhost:8080/` (or `http://<your-lan-ip>:8080/` from
your Android phone, if it's on the same Wi-Fi — note Web NFC still needs
HTTPS unless the host is `localhost`, so use this only to check the
reveal/code UI on desktop; do the real phone test after deploying to an
HTTPS host).

Alternatives: Python's `python -m http.server 8080`, or VS Code's
"Live Server" extension.

## Testing without physical tags

Open the app with a query parameter to simulate a scan, e.g.:

```
https://your-host/?tag=relic-01
```

This is only a convenience for testing the reveal/code screens and does
not bypass the code hash check.

## Deploying (example: GitHub Pages)

1. Push this folder to a GitHub repository.
2. Repo Settings → Pages → Deploy from branch → pick `main` and `/root`.
3. Wait for the `https://<user>.github.io/<repo>/` URL to go live.
4. Open that URL on the Android phone and tap **TAP TO SCAN** (this must
   be a real user gesture — Web NFC requires it).

Any other static HTTPS host (Netlify, Vercel, Cloudflare Pages, S3 +
CloudFront, etc.) works the same way — just upload the folder as-is.

## File structure

```
index.html            Main app markup
css/style.css          Black/green terminal theme
js/app.js              NFC scanning, routing, hashing, UI logic
config.json            All player-facing text, tag map, code hashes
tools/hash-generator.html   Offline utility to generate salted hashes
images/                 Put reveal/success images here
```
