# Meridian

A board-style question bank: 1,000 sample items across ten internal-medicine
categories, with custom test assembly, peer-referenced difficulty, passage
highlighting, and an integrated notebook.

It runs entirely in the browser. No account, no server, no build step, no
dependencies. Everything you create — answers, tests, highlights, notes — is
stored in `localStorage` and never leaves your machine.

> **Sample content.** Clinical detail throughout the bank is illustrative
> placeholder material generated to demonstrate the platform. It is not clinical
> guidance and should not be studied as fact. The *structure* is the deliverable:
> swap in real items and everything else keeps working.

## What it does

**Assemble a test.** Filter the bank by status (unused, incorrect, correct,
marked), category, difficulty band, and question type. The available count
updates on every change, and the primary action stays disabled — with the reason
stated — rather than failing after you commit to it.

**Two modes.** *Tutor* opens the explanation the moment you submit an answer.
*Timed exam* locks answers away and reveals everything at the end, with an
optional per-question clock.

**Difficulty from performance.** Every item carries the share of readers who
answered it correctly, which places it in one of four bands — Foundational (78%
and above), Standard (62–77%), Challenging (48–61%), Rigorous (below 48%). After
you answer, you see the full answer distribution and how your time compares.

**Highlight and clip.** Select any passage in a vignette or explanation to
highlight it in one of four colours. Highlights are stored as character offsets
against a stable block id, so they survive reloads and re-renders. Figures and
tables in explanations carry their own *Save to notebook* action, and a clipped
figure keeps its spec — so it redraws with the theme rather than pasting a stale
image.

**A real notebook.** Notebooks, notes, tags, and search. Markdown with a
formatting toolbar and a preview mode. Clippings render inline with a link back
to the question they came from. Export a single note or the whole notebook as
Markdown.

**Know where you stand.** Accuracy over time, by category, and by difficulty,
each with the peer average marked for comparison, plus coverage of the bank.

## Running it

Any static file server works. The app fetches JSON, so opening `index.html`
directly from the filesystem will not work — browsers block local data files.

```bash
python3 tools/serve.py 4173
```

Then open <http://localhost:4173>.

## Regenerating the bank

```bash
node tools/generate.mjs
```

`tools/content/topics.mjs` holds the taxonomy — ten categories of twelve topics,
each with a presentation, examination finding, initial study, initial
management, mechanism, and teaching point. `tools/generate.mjs` combines those
across five question archetypes (diagnosis, management, diagnostic testing,
mechanism, physical findings) into 1,000 items, writing:

- `data/index.json` — the light index loaded at boot; drives every filter and count
- `data/questions/<category>.json` — full item bodies, fetched per category on demand
- `data/reference.json` — the laboratory reference intervals sheet

Generation is seeded, so the same input always produces the same bank.

To use real content, replace the topic file or write your own generator — the
app only depends on the shape of the emitted JSON.

## Keyboard

| Key | Action |
| --- | --- |
| `⌘K` or `/` | Search questions, notes, and pages |
| `?` | Keyboard reference |
| `A`–`E` / `1`–`5` | Choose an answer |
| `↵` | Submit, then advance |
| `←` `→` | Previous / next item |
| `M` | Mark for review |
| `H` | Highlight the selection |
| `L` | Reference intervals |
| `⌘\` | Show or hide the side panel |
| `Alt`-click | Strike through an answer choice |

## Layout

```
index.html              application shell
assets/css/app.css      tokens, reset, layout, primitives
assets/css/views.css    per-view styling
assets/js/core/         dom, store, bank, router, formatting
assets/js/render/       figures, tables, prose, shared item rendering
assets/js/features/     highlighting, notebook capture, overlays
assets/js/views/        one module per route, lazily imported
data/                   generated question bank
tools/                  generator, topic content, dev server
```

## Notes on the build

The store is the only writer to `localStorage`; writes are debounced and flushed
on unload, and a quota failure surfaces as a toast rather than silent data loss.
Views are lazily imported per route and return a descriptor the shell uses to
paint the chrome, so adding a page means adding one module and one route.
Figure styling is scoped to the `svg` element itself rather than its wrapper,
which is what lets a clipped figure look identical inside a notebook entry.
