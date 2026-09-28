# Lens Loop

A single-page web app for a phone: prop the phone up, open the page, tap **Start**. Every N seconds (15 by default) it takes one frame from the camera, sends it to Claude through the Messages API, and streams the answer onto the screen. The previous answers stay in a list below.

- `index.html` is the whole app. No build step, no server; it talks to `api.anthropic.com` directly from the browser.
- Your API key is typed into the page's settings and stays in that phone's browser storage. Nothing in this repository holds a key.
- Defaults: `claude-opus-5-5`, effort `max`, one frame every 15 s, 1568 px images, 32,024 max output tokens, large text. All of it is adjustable in the settings sheet.
- The camera fills the screen; the answer floats over its lower part and can be hidden with a tap.
- On phones whose browser exposes camera zoom (iOS 17+), zoom presets appear on the view (widest lens, 1×, 2×) and the widest is used by default; every lens the phone reports is also listed in the camera picker. The camera is asked for its highest resolution before the frame is scaled to the chosen size.
- A link of the form `…/lens-loop/#key=sk-ant-…` carries the key in the fragment, which browsers never send to the server. The page reads it on every open and keeps it in the address, so a bookmark or Home Screen icon made from that link launches with the key. It is also copied into the browser's storage so the plain address works while that lasts.

Published with GitHub Pages straight from the `main` branch.
