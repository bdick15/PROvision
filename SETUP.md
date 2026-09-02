# PROvision — setup

Six files. They all sit together in one folder, and none of them
need a build step or a server.

    index.html            the app
    library.js            the starting recipes
    sw.js                 the service worker (offline)
    manifest.webmanifest  makes it installable
    icon-192.png
    icon-512.png

## 1. Put them on GitHub Pages

1. Make a GitHub account if you don't have one.
2. Create a new repository. Call it `provision`. Public is fine —
   your API key is not in these files.
3. On the repo page choose **Add file → Upload files**, drag all six in,
   and commit.
4. **Settings → Pages**. Under Source pick `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
5. Wait a couple of minutes. Pages will show your URL, which looks like
   `https://yourname.github.io/provision/`.

## 2. Get your API key

1. console.anthropic.com, sign in, add a payment method.
2. Set a monthly spend limit. Low. You will not get near it.
3. Create a key and copy it.

## 3. Install it on the phone

1. Open your Pages URL in **Safari** on the iPhone. Not Chrome.
2. The settings panel opens on first run. Paste the key, press Save key.
3. Fire a batch to check it works.
4. Share → **Add to Home Screen**.

The icon and name come from the manifest, so no Shortcuts workaround
and no custom-icon step. Open it once more from the Home Screen while
you still have signal — that first launch is when the service worker
caches everything.

## 4. Check it offline

Turn on Airplane Mode and open it. It should load instantly and the
status pill should read `offline`. Fire a batch: you'll get tickets
from the library instead of Claude.

## How it behaves

- **Online with a key** — generates fresh dishes. `Keep` on any ticket
  saves it to your library forever.
- **Offline, or no key** — matches your ingredients against the library.
- **Online but the call fails** — falls back to the library rather than
  showing an error.

Everything lives on the phone: key, library, today's menu. No account,
no sync, nothing leaves the device except the request to Anthropic.

## Updating it later

Upload the changed file to the repo, and **bump `CACHE` in `sw.js`**
(`provision-v1` → `provision-v2`). Without that bump, phones keep
serving the old cached copy. Then open the app twice — the first launch
fetches the update, the second shows it.

## Backups

The library is on the phone only. Lose the phone, lose the recipes.
Settings → Export library gives you a block of text. Mail it to
yourself occasionally. Import merges by title and never overwrites.
