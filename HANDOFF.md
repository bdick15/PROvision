# The Pass — handoff spec

A recipe-ideas app. You type what's in the fridge, it returns five dishes
formatted as kitchen dupe tickets.

`the-pass.html` is the working prototype: one file, no build step, no
dependencies. Read it first — the layout, animation and copy are all worth
keeping. What needs to change is everything behind the fetch call.

## The one thing that must change first

The prototype calls `https://api.anthropic.com/v1/messages` directly from the
browser with **no API key**. That only works inside Claude's artifact sandbox,
which injects auth. Outside it, the call fails.

A real app needs a server. The key lives there, never in the client.

```
client  →  POST /api/tickets  {ingredients, meal, rules}
server  →  Anthropic Messages API  (ANTHROPIC_API_KEY from env)
server  →  returns parsed ticket JSON
```

Do not ship the key to the client under any arrangement — not in a bundle,
not in an env var prefixed for the frontend, not "temporarily".

Also move the two prompts server-side while you're there. They're currently
inline in `fire()` and in the "Full method" handler.

## Suggested shape

Make it a **PWA**. It solves two problems already hit in the prototype:

- A web manifest plus `apple-touch-icon` gives a real Home Screen icon
  (`the-pass-icon.png` is 1024×1024 and ready). No Shortcuts workaround.
- Self-hosted means no Claude sign-in wall, which is what broke the
  published-artifact route.

Stack that fits the size of this thing: any small Node server (Express,
Hono, or a single serverless function) plus the existing HTML as the
frontend. Resist turning a 300-line file into a framework app.

## Current behaviour to preserve

- **Input**: freeform ingredient textarea, plus one-tap staple chips that
  append to it.
- **Meal**: Lunch / Dinner, single-select, tap again to clear.
- **Rules**: Vegetarian, No oven, Under 30 min, One pan, Salad, Appetizer,
  Main, Soup, Hot dish, Cold dish. Multi-select, all optional.
- **Output**: five tickets, staggered print animation, each showing title,
  one-line note, minutes, ingredient tags used, "buy" tags for anything
  missing, and three short steps.
- **Full method**: per-ticket button, second model call, returns prose.
- **Tolerant parsing**: `parseTickets()` walks the reply object by object so a
  truncated response still yields whole tickets. Keep this — model output
  will get cut off sometimes. Server-side, prefer a structured output /
  tool-use schema so it stops being guesswork.
- **Error surface**: the error box names the failing stage. Useful in dev,
  worth replacing with something friendlier before anyone else uses it.

## Design tokens

```
steel-900 #0F1519   steel-800 #18232A   steel-700 #22323A   steel-500 #3A5058
paper     #F2F0E9   paper-shade #DFDCD0  ink      #1B1714
lamp      #FFB020   chive     #93AC6E    alarm    #E2603F
```

Type: IBM Plex Sans Condensed (UI, uppercase + wide tracking for headings),
IBM Plex Mono (ticket content, chips, labels). The concept is a kitchen pass:
amber heat-lamp glow over cold steel, white paper tickets on a rail.

## Backlog

- Pantry list that persists, so staples don't get retyped every time
- Save a ticket you liked; a small recipe box
- Hot dish / Cold dish should probably be exclusive of each other
- Share or print a single ticket
- Servings count
- Rate limiting on the API route before this is public
