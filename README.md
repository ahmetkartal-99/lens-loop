# Lens Loop

A single-page web app for a phone: prop the phone up, open the page, tap **Start**. Every N seconds (15 by default) it takes one frame from the camera, sends it to Claude through the Messages API, and streams the answer onto the screen. The previous answers stay in a list below.

- `index.html` is the whole app. No build step, no server; it talks to `api.anthropic.com` directly from the browser.
- Your API key is typed into the page's settings and stays in that phone's browser storage. Nothing in this repository holds a key.
- Defaults: `claude-opus-5-5`, effort `max`, one frame every 15 s, 1024 px images. All of it is adjustable in the settings sheet.

Published with GitHub Pages straight from the `main` branch.
