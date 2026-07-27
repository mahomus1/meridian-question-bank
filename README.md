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

**Rule choices out.** Working an item usually means eliminating before
committing. Every choice carries a ⊘ control, and right-click or ⌥-click does
the same. Ruled-out choices grey out and strike through, and can be brought
back. A one-time tip points the control out, then never appears again.

**Highlight and clip.** Select any passage in a vignette or explanation to
highlight it in one of four colours. Highlights are stored as character offsets
against a stable block id, so they survive reloads and re-renders. Figures and
tables in explanations carry their own *Save to notebook* action, and a clipped
figure keeps its spec — so it redraws with the theme rather than pasting a stale
image. The **Highlights** page collects every passage you have marked across the
bank, filterable by colour and category, each one a click from its item.

**The notebook sits beside the page.** One editor panel opens on any view —
mid-question, browsing the bank, anywhere — so a thought goes down without
leaving what you are reading. It is resizable, and on narrow screens it slides
over the page rather than squeezing it. `⌘J` opens and closes it.

**What is open is where things land.** There is no destination to configure:
whatever note the panel is showing is where a clipped passage, figure, or table
goes. Switching notes switches the destination, and you can always see which one
it is.

**A real toolbar.** Undo and redo, a paragraph-style menu (body, title,
heading, subheading, quote, code block), bold, italic, underline, strikethrough,
text colour, highlight, bulleted and numbered lists, indent and outdent,
alignment, links, and clear formatting. The shortcuts you already know work too.
Markdown shorthand converts as you type — `## ` makes a heading, `- ` a bullet,
`1. ` a numbered list, `> ` a quote. The first line of a note is its title, so
there is no separate field for it and nothing is ever called "Untitled".

**Export to Word.** Choose how question references appear — a numbered list
under "Sources" at the end, a line beneath each passage, or nothing at all. A
note or the whole notebook exports as a genuine `.docx` —
an Office Open XML package built and zipped in the browser, not an HTML file
wearing the extension. Headings, lists, quotes, colour, and every run-level mark
become real Word constructs; clipped tables become real Word tables; and figures
are rasterised and embedded as images, forced to the light palette so a note
written in dark mode still prints. There is no dependency and no build step —
the ZIP writer is about a hundred lines.

**Clippings are just text.** A passage sent from a question becomes an ordinary
paragraph — same face, no frame, no background, nothing marking it as an
attachment. Its origin lives on the paragraph as an attribute, shown only as a
small dot in the margin that opens the source question when clicked, and that
can be switched off entirely. Figures and tables cannot be prose, so they sit
plainly inline without a frame. Every block has a drag handle, so anything can
be moved anywhere.

**Notebooks and notes.** Notebooks are folders you create, name, colour, and
delete. The Notes page is a plain list for finding something again; the writing
happens in the panel. Export a note or the whole notebook as Word.

**Know where you stand.** Accuracy over time, by category, and by difficulty,
each with the peer average marked for comparison, plus coverage of the bank.

## Running it

Any static file server works. The app fetches JSON, so opening `index.html`
directly from the filesystem will not work — browsers block local data files.

```bash
python3 tools/serve.py 4177
```

Then open <http://localhost:4177>.

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
| `⌘J` | Open or close the notebook |
| `⌥`-click | Rule a choice out (or right-click it, or use the ⊘) |
| `⌘B` `⌘I` `⌘U` | Bold, italic, underline in a note |
| `⌘↵` | Save the note you are writing in the item panel |

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
