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

**Model and effort are quality settings, not cost settings.** Runs on
`claude-opus-5` at `effort: "high"`. It spent a short period on
`claude-sonnet-5` at `effort: "low"` — that pairing was chosen while fixing
the token starvation above, to stop the budget blowing out, and it is the
wrong shape for this job: deciding what a fridge full of odds and ends
wants to become is entirely judgment, and low effort is meant for
classification and subagents. If the tickets ever start reading generic,
check these two before touching the prompt.

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

**The book is stored twice, deliberately.** Titles and the match haystack —
title, categories and the raw ingredients string, lowercased — live in
`provision:paprika` in localStorage, so `ownedNear()` can score 890 recipes
synchronously on every fire. The full text, ingredients and method, goes to
IndexedDB (`provision` / `recipes`, keyed on lowercased title) because it is
roughly 1.6MB for 890 and a multi-megabyte synchronous write on import would
block the page.

Both are written once at import and never on any other path. Losing either
costs nothing — re-import rebuilds them.

When "From the book" is on, the twelve strongest matches are hydrated from
IndexedDB and go into the prompt with their real ingredients and method.

**A book ticket adapts the cook's recipe to the fridge, and that is wanted.**
It arose by accident — the fridge rule declares that it beats everything
below it, and the book block sits below — but the result turned out to be the
most useful thing the source does, so it is now stated outright in both the
brief and the hard rule instead of left as two instructions fighting. Their
version is the basis; the fridge decides what changes. Do not "fix" this back
to faithful reproduction.

Because heavy adaptation leaves little of the original, book candidates are
ranked by **coverage** — how much of the recipe's own ingredient list the
fridge can actually supply — rather than by raw overlap. That needs each
recipe's ingredient words, stored as `g` in the localStorage index at import
(~150 bytes each). There is no coverage threshold: a thin fridge would return
nothing at all. Twelve is about two thousand tokens. If IndexedDB is unavailable or a
book predates this, hydration returns nothing and the prompt falls back to
the older reconstruct wording — matching and steering still work.

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
payload is already compressed. Verified against Python's `zipfile` and
confirmed on device: Paprika imports it, so the missing `hash` and
`photo_data` fields do not matter.

**The share sheet never routes to Paprika — don't try again.** Safari hands
a shared file over as generic data, and Paprika claims the
`.paprikarecipes` extension, which only survives once the file is on disk.
Tested across four MIME types including omitting it entirely; Paprika
appears in the sheet under none of them. **Save for Paprika** therefore
writes straight to Files with an `<a download>`, skipping the sheet, and
that route imports in one tap. `Share…` stays for AirDrop and Mail.

**Ingredients come from the full method, not the ticket.** A ticket's
`uses` are the words the matcher keyed on and `needs` is a shopping list,
so sending those produced Paprika recipes whose ingredients read "rice,
cumin (to buy)" with no quantities anywhere. The method is asked for as a
one-line ingredient list followed by numbered steps, and `splitMethod()`
takes it back apart — one ingredient per line, which is what Paprika
expects, splitting on commas except inside brackets so "thighs (2 per
person, bone-in)" stays whole. Both send buttons are hidden until the full
method has been fetched, because before that there is nothing worth
sending.

## The three sources

A ticket comes from one of three places and says which on the dupe.

| | Dish | Method |
|---|---|---|
| **Off the cuff** | invented | invented |
| **From the book** | the cook's own | the cook's own, quoted from IndexedDB |
| **From the canon** | a real, well-known dish | **the model's rendition** |

**From the canon does not search.** It is a prompt instruction and nothing
more — the fire request carries no tools. The dish name will be genuine; the
ingredients and steps are the model's. It was called "Off the wire" until the
label was judged to over-promise: it implied a source you could go and check,
and there isn't one. Rename it back only alongside real search.

There is a tension worth knowing about here. Every dish must be built from
what is aboard, so a canon ticket is a well-known dish *bent to the fridge* —
not the canonical version. Book tickets resolve this by handing over the real
text; canon tickets reconcile it silently, so the brief asks the model to say
in the note when it has adapted something.

Web search is proven to work with structured output (see the recipe creator),
so a per-ticket "find the real recipe" is the cheap upgrade path: fires stay
around 10c and a search costs ~15c only on the dish actually being cooked.
Searching the whole fire would put real recipes in context for the invented
tickets too, and pull them toward what the model just read.

## Taste

Ratings live in `provision:taste` as `{liked, disliked}`, each capped at 30,
newest first. Each entry keeps the title **and the one-line note** — the note
is where a dish's character actually sits, so "thighs crisped hard, lemon
squeezed over hot" tells the model far more than the title alone.

**A dislike steers, it does not ban.** The prompt says so explicitly: lean
away from that style, but a disliked dish may still appear if it genuinely
fits the fridge and its brief. That is the cook's own definition and it is
deliberate — the avoid-list is a separate mechanism and already handles
"never this again".

The taste block is distinct from `banned` (recent titles) and from the
Paprika book. Three different jobs: don't repeat yourself, don't hand them
what they own, and cook the way they like.

## Recipe creator

A second view in the same file, not a second page — it reuses `ask()`,
`toPaprika()` and the galley brief, and duplicating those to keep the pages
apart would be the worse trade. Describe a dish and "Write it" composes one,
which then saves to Paprika through the existing writer.

There was a "Find one online" that searched and returned a real published
recipe with its URL. It worked, and it was removed on cost: 20-40c a press
against 8c for a whole fire. The search plumbing in `ask()` (a `tools`
argument) is still there and still works if it is ever worth turning back on.

**Web search and structured output do compose**, despite the documented
warning that citations and `output_config.format` are incompatible. Tested
against the live API: `end_turn`, real URLs, schema-valid JSON in one
request. No backend and no second key — the tool runs on Anthropic's
servers.

**Searches are the expensive part.** Results land in the request as input
tokens: five searches came to 91k tokens, about 58c a go. `max_uses` is 3.
Raise it only with a reason.

A created recipe arrives whole — real quantities in `ingredients` — so
`toPaprika()` branches on that and skips the ticket path, which only gets
quantities once the full method is fetched.

## Things that will bite

- **Bump `CACHE` in sw.js AND `VERSION` in index.html on every deploy**,
  to the same number (`v22` → `v23`). VERSION shows as a pill in the header;
  they drift apart the moment one is bumped without the other, and then the
  pill lies about which build is running.
- **The service worker is network first**, cache only as fallback, with a 4s
  timeout. It was cache-first with a background refresh, which meant every
  deploy needed the app opened twice — and the home screen app keeps its own
  registration separate from Safari, so it could sit a version behind for
  days while Safari showed the new one. Don't switch it back for
  offline-first reasons: there is no offline mode, the boat has Starlink.
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
