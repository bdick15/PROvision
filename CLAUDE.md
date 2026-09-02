# PROvision — working notes for Claude Code

A recipe app for a yacht chef. Type what's in the fridge, get five dishes
back as kitchen dupe tickets. Runs as a PWA from GitHub Pages and calls
Claude directly from the browser. The boat has Starlink, so there is no
offline mode: no signal is an honest error, not a downgrade to canned
results. Paprika stores and reads the recipes; this app only has ideas.

Static site. No build step, no framework, no server. Keep it that way.

    index.html            everything — markup, styles, logic
    sw.js                 service worker
    manifest.webmanifest
    icon-192.png / icon-512.png
    SETUP.md              deploy instructions for the owner

## Run it locally

The service worker needs http, not file://

    python3 -m http.server 8000

Then open http://localhost:8000. Paste the API key into Settings on
first run — it goes to localStorage, never into any file. Never commit
a key.

## The model call

`ask()` posts to `/v1/messages`. Two parts of the request shape are
load-bearing, and both were once wrong in ways that looked like a parsing
bug:

- **No assistant prefill.** A trailing assistant turn returns
  `400 — This model does not support assistant message prefill.`
  Prefilling `[` to force a JSON array was tried; it cannot work on this
  model. Structured output does that job now. Don't reintroduce it.
- **Thinking is on by default and bills against `max_tokens`.** This is
  what produced **"No complete tickets in the reply."** At `max_tokens:
  1400` the model spent 1399 tokens thinking, returned a lone `thinking`
  block with no text, and `parseTickets("")` returned `[]`. Reproduced
  10/10 against the live API. Keep `output_config.effort: "low"` and keep
  the cap generous — 8000 for tickets, 4000 for the full method. Real
  spend is ~1000–2200 output tokens, of which up to ~1400 is thinking.

`output_config.format` carries `TICKET_SCHEMA`, so the reply is a JSON
object rather than prose to be scraped. The schema cannot express counts
— the API rejects `maxItems`, and `minItems` above 1, on arrays — so
"exactly 3 steps", "exactly 5 tickets" and the word limits live in the
prompt as prose. **Keep those two in sync**; the schema will not catch a
drift.

`readTickets()` reads the object. `parseTickets()` stays behind it as the
fallback for a truncated reply — don't delete it. An empty reply now
throws `EMPTY REPLY — stop_reason …, N thinking`, which is the honest
error for a starved cap; it used to arrive downstream disguised as a
parse failure and cost days.

Measured against the live API, same fridge — baseline 10 runs, fixed 50:

    parse success      0/10        ->  50/50
    ingredients used   no tickets  ->  250/250 on brief
    stop_reason        max_tokens  ->  end_turn

## Testing a prompt change

Do this before believing any prompt or model change. There is **no node
on this machine** — JavaScriptCore runs the app's script fine:

    osascript -l JavaScript bundle.js

Capture the real request rather than retyping it: stub the DOM, load the
inline script, and call `fire()` with a `fetch` that records its argument
and throws. That yields the exact body, prompt included. Then curl it:

    curl https://api.anthropic.com/v1/messages \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "content-type: application/json" \
      -d @request.json

Check `stop_reason` and `usage.output_tokens_details.thinking_tokens`
first — those two fields explain most failures here. A harness that runs
it N times and reports parse rate, dish variety and whether ingredients
were respected is worth more than any single fix. Fifty runs costs a few
cents. Seed `banned` from each run into the next or the variety number
is meaningless.

## How generation is put together

`fire()` assembles the prompt from, in order:

- `BRIEFS[service]` — crew or guest voice. Crew is the default and the
  common case: familiar food, generous, minimal washing up, no foams.
- **The ingredients**, as a hard rule that explicitly outranks everything
  below it. This placement matters — it was buried before and the model
  invented proteins the cook never mentioned.
- `GALLEY` — stovetop and combi steam only. No charcoal, no barbecue, no
  open flame, no deep fryer. Grilling means a grill pan. The boat moves.
- `banned` — last 40 generated titles from localStorage, to stop it
  circling back to the same dishes.
- `buildBriefs(service)` — five role briefs drawn from a pool of fifteen
  and shuffled, each paired with a flavour angle.

Two rules that exist for a reason:

- **Roles describe how a dish eats, never what it is.** An earlier version
  said "one pan or one tray" and "better reheated tomorrow" and produced
  a traybake and a ragu every single fire. Don't reintroduce format words.
- **Angles are flavour and region only.** When they named formats too,
  they collided with the roles — "served cold" leaning "a proper soup".

`onBrief()` is a backstop: any ticket sharing no ingredient with what was
typed gets dropped before rendering, and the rail header says how many.
It currently drops nothing — 0 of 250 tickets across the last benchmark —
so any nonzero count is news. If it is regularly above one the prompt is
failing and the filter is covering for it. That's a signal, not a
solution.

## Paprika

Paprika is the system of record. This app never stores a recipe you care
about — it proposes dishes, and hands the good ones over.

**The book** (`provision:paprika`) is a derived index of what Paprika
already holds: title, categories and the raw ingredients string, lowercased
into one haystack per recipe. Written once at import, never on any other
path. Losing it costs nothing — re-import rebuilds it.

Two decisions worth not relitigating:

- **No ingredient parsing.** Matching only needs `hay.includes("chicken")`,
  so `"1.2kg bone-in chicken thighs"` never has to become `["chicken
  thighs"]`. Turning free text into clean tokens is a hard problem that
  buys nothing here.
- **Photos are dropped.** Measured on a real export: 78 KB per recipe, 97%
  of it base64 `photo_data`. Whole recipes for 800 would be ~62 MB. The
  index is ~440 KB.

`ownedNear()` picks the dishes in the book this fridge could actually
produce and feeds them to the prompt beside the recent-titles list, so the
model stops proposing what the cook already owns. It drops words appearing
in more than a quarter of the book first — without that, *carrots* and
*wine* matched 8 of 9 test recipes and handed the model most of the book as
"avoid these", which is the same as telling it nothing.

**Sending back**: `zipStore()` writes the same container Paprika exports —
a zip of gzipped recipe JSON, entries stored rather than deflated since the
payload is already compressed. Verified against Python's `zipfile`; the
field set matches a real export except `hash` and `photo_data`. Delivery is
`navigator.share({files})`, which must happen inside the tap's activation
window, with a download fallback.

## Things that will bite

- **Bump `CACHE` in sw.js on every deploy** (`provision-v7` → `v8`).
  Without it phones serve the old cached copy. Then open the app twice —
  first launch fetches, second shows.
- `anthropic-dangerous-direct-browser-access: true` is required or the
  request fails CORS. Don't remove it.
- The catch in `fire()` falls back to the library. It now prints the real
  error above the results — keep that. An earlier version swallowed it
  and cost a day of blind guessing.
- localStorage holds the key, the Paprika book, kept tickets, today's
  menu and recent titles. **Reinstalling the app wipes all of it** — this
  has already happened once. The book is derived, so re-import fixes it;
  the key has to be pasted again.
- iOS Safari is the only target that matters. Test there before calling
  anything fixed.

## Backlog

- Retire "Keep" and the local library. With no offline mode and Send to
  Paprika in place it stores nothing anyone reads; the Settings
  export/import go with it.
- Hot dish / Cold dish should be mutually exclusive, like Lunch/Dinner.
- Servings count.
- Share or print the day's menu.
