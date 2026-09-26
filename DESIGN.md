# Cutback — Design System

Paste this whole file into Codex / Claude Code / Grok before asking for any UI work. Treat it as the brief. Do not deviate from it toward generic "AI app" defaults (rounded cards with identical soft shadows, tracked-out ALL-CAPS labels, gradient washes, favicon-only branding, emoji as icons).

## What this product is

Cutback is a voice-controlled video editor. The user talks to an AI (built on AssemblyAI) instead of clicking through menus — "cut this down to the best 30 seconds," and the AI proposes an edit the user approves or rejects. This is the entire pitch of the hackathon submission. The UI's job is to make that conversation feel like the main event, with the video as the thing being acted on — not a chat app with a video player bolted to the side.

**Reference points:** think Descript's editor (transcript-driven, calm, confident chrome) crossed with CapCut's desktop timeline (dense, tactile, clearly a pro tool) — not a generic SaaS dashboard.

## Color

| Token | Hex | Use |
|---|---|---|
| `--bg-base` | `#0E1013` | App background |
| `--bg-panel` | `#171A1F` | Sidebar, panels, timeline track background |
| `--bg-elevated` | `#20242B` | Cards, the video frame mat, active states |
| `--line` | `#2A2F38` | Hairline dividers between panels/tracks |
| `--text-primary` | `#EDEFF2` | Headings, active labels |
| `--text-secondary` | `#8A8F99` | Inactive sidebar labels, timestamps |
| `--accent` | `#5EE6C4` | Voice-active state, selected track, primary CTA (mint, not generic purple/green-acid) |
| `--accent-warm` | `#FF8B5E` | Recording/listening pulse only — never used for static UI |

No gradients as decoration. No drop shadows softer than `rgba(0,0,0,.35)` — flat elevation via color contrast, not blur.

## Type

- **UI/labels/body:** Inter or General Sans — one family, weights 400/500/600 only.
- **Timecodes/durations:** a monospace (JetBrains Mono or IBM Plex Mono) — this is the one place a mono face is earned, because it's literally numeric data that needs fixed-width alignment.
- No all-caps labels anywhere. Sentence case only ("Media", not "MEDIA").

## Layout concept

```
┌─────────────────────────────────────────────────────────┐
│ Project name          Aspect: 9:16 ▾           [Export]  │
├───────┬───────────────────────────────────┬──────────────┤
│       │                                   │              │
│ side  │        VIDEO — fills frame,       │   Media      │
│ nav   │        thin mat, no dead space    │   bin        │
│       │                                   │              │
│       ├───────────────────────────────────┤              │
│       │ [mic] speak to edit  ⌄ (collapsed)│              │
├───────┴───────────────────────────────────┴──────────────┤
│ Timeline: Video / Captions / Audio — clear row separation │
└─────────────────────────────────────────────────────────┘
```

Left-aligned, dense, functional. The video preview is the largest single element on the screen at all times — it should never be smaller than roughly 55% of the vertical space above the timeline.

## Fixing the specific problems in the current build

**1. Video preview is starved for space**
The "Listening… Ready. Tell me what to change" bar currently eats a full-width permanent row. Collapse it to a compact pill by default: mic icon + one line of status text, sitting just under the scrubber, maybe 40px tall. On tap/while actively listening, it expands into a slightly taller panel with the live transcript of what the user's saying — then collapses back down once the AI responds. The video frame should visibly grow when the voice panel is collapsed.

**2. "Original / Edited" vs "Original ▾" (aspect ratio) read as duplicates**
They're different controls but the shared word "Original" makes them look like a bug. Rename:
- Preview state toggle → **Before / After** (not "Original/Edited")
- Aspect ratio dropdown → keep it as a dropdown but label it clearly, e.g. **Frame: 9:16 ▾** with the icon of the current ratio next to it, not the bare word "Original"

**3. Caption blocks overflow their track**
Truncate with ellipsis at the block's width; show the full caption text on hover as a tooltip, or in the Transcript panel if it needs full visibility. Never let text render past its container edge.

**4. Only one video can be uploaded**
Add multi-file select to "Select local video" (accept multiple, standard `<input type="file" multiple>`), and let the Media bin show each as its own thumbnail. This matters for the pitch too — talking to the AI about "swap in the second clip" or "cut between these two" is a stronger demo of voice control than a single-clip editor.

**5. Timeline tracks blend together**
Alternate subtle background tint between Video / Captions / Audio rows (`--bg-panel` vs `--bg-elevated`), and add a 1px `--line` divider between each.

**6. Sidebar has no hierarchy**
Active item (e.g. "Media") gets `--text-primary` + `--accent` left-border indicator (2px). Inactive items get `--text-secondary`, no border.

## Icons

Use **Lucide** icons throughout (`lucide-react` if React). No emoji, no default browser/OS icons, no favicon-as-branding. Give the app itself a real wordmark or simple monogram mark, not just a favicon in the tab.

## What to explicitly avoid

- Identical rounded-corner cards with the same soft gray shadow on every panel
- Tracked-out ALL-CAPS eyebrow labels above headings
- Middle-dot-separated meta strings ("Media · 3 clips · 00:08")
- A "→" appended to buttons/links by default
- Treating the voice/chat feature as a secondary chat bubble UI — it's the core mechanic, it should feel integrated into the editing surface, not bolted onto the layout as an afterthought
