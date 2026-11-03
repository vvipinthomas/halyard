# Harbor — Halyard's design system

Harbor is meant to feel calm, quick and friendly for people who use Halyard every day. A live version of everything below is in the app under **Settings → Design system**.

## Principles
1. **Calm by default, delightful on purpose.** Neutral surfaces; colour and motion are saved for state changes (a run starting, an output accepted).
2. **The crew carries the personality.** Characters animate by real state (thinking, working, using a tool, talking, happy, sad, sleeping) and never fake progress.
3. **Fast paths everywhere.** Command palette (`⌘/Ctrl K`), `g`-chords to jump, `/` to search, `n` for a new agent, `?` for help.
4. **Honest UI.** Estimates carry an `EST` badge; dry runs are labelled; errors say what to do next.
5. **Accessible.** Visible focus rings, ≥4.5:1 text contrast in both themes, roles on dialogs and tabs, and `prefers-reduced-motion` respected (animations stop; states remain readable).

## Files
| File | Contains |
|---|---|
| `public/css/tokens.css` | Primitive scales (colour, space, radius, type, motion, z-index) and semantic tokens for light and dark |
| `public/css/components.css` | Layout, buttons, chips, tabs, forms, tables, cards, KPI tiles, overlays, palette, toasts, skeletons, empty states |
| `public/css/crew.css` | The character rig and its state animations |
| `public/js/icons.js` | Original 24px stroke icon set: `icon(name)` |
| `public/js/mascot.js` | `crewHTML(mascot, size, state)` and `setCrewState(el, state, revertMs)` |

## Tokens
- **Colour:** components use semantic tokens only: `--bg`, `--bg-raised`, `--bg-sunken`, `--fg`, `--fg-muted`, `--border`, `--brand` (coral), `--accent` (sea), `--success`, `--warning`, `--danger`, each with a `-soft` tint. Re-theme by overriding semantic tokens.
- **Space:** 4px grid, `--sp-1` (4) to `--sp-12` (48).
- **Radius:** `--r-sm` 8, `--r-md` 12, `--r-lg` 16, `--r-xl` 22, `--r-pill`.
- **Type:** UI in `--font-sans`; headings in the rounded `--font-display`; code in `--font-mono`. Scale `--fs-xs` (12) to `--fs-3xl` (34).
- **Motion:** `--dur-fast` 120ms, `--dur-base` 200ms, `--dur-slow` 320ms; `--ease-out` for entrances, `--ease-spring` for playful pops. All durations become 0 under reduced motion.
- **Elevation:** `--shadow-1` (rest), `--shadow-2` (hover/raised), `--shadow-3` (overlays).

## Components (class → use)
- `.btn` with `.primary` (one per view), `.dark`, `.ghost`, `.danger`, `.sm`, `.icon`; `aria-busy="true"` shows a spinner.
- `.chip` with `.ok`, `.warn`, `.bad`, `.info`; `.est` marks estimates; `kbd` for shortcuts.
- `.tabs` / `.tab[aria-selected]`: segmented control for sub-navigation.
- `.card`, `.card.interactive` (hover lift), `.card.table-card` (flush table), `.hero`, `.banner(.info|.danger)`.
- Forms: native inputs styled globally; `.toggle` switch; `.otp` for one-time codes; `.field-hint`.
- Overlays: `.drawer` (edit and detail, slides in, focus returns on close), `.modal` (decisions such as approvals), `.palette` (command palette).
- Feedback: `toast(msg, 'ok'|'bad'|'info')`, `.skeleton` while loading, `.empty` with sleeping crew for empty states.

## Crew characters
Every agent is an **original full-body** character: 20 species × 10 accessories × any colour, plus a **role badge**. The style is soft 3D, inspired by the polished feel of modern agent apps without copying any brand's characters:
- **Full body:** head, torso with belly, arms with paws (wings for birds, flippers for penguins, jointed arms for robots), feet, and species tails (bushy fox, striped raccoon, paddle beaver…).
- **Realism cues:** iris eyes with pupils, an upper-lid shadow and two catchlights; a glossy nose; a fur-edge texture on furry species; occlusion shadow where the head meets the body; rim light on the shaded side.
- **Poses:** arms rotate at the shoulder, so states are acted out: wave on hover, type while working, hand to chin while thinking, reach for the gear when using a tool, both arms up when celebrating, arms in when sad or asleep.
- **Tile:** a rounded app-icon square (28% radius) with a light tint of the agent's colour and an inner highlight, so a crew reads as a consistent set of icons.
- **Lighting:** bodies use a radial gradient (highlight top-left → base → shade bottom-right), a specular sheen, a soft ground shadow, and glossy eyes with two catchlights.
- **Role badge:** a white disc bottom-right with a Harbor icon for what the agent does (code, shield, chart, chat…). It grows at small sizes so it stays legible, and is hidden in overlapping avatar stacks.
- **Robustness:** gradient ids are unique per instance; state layers default to hidden, so an icon exported without CSS still looks right; labels are escaped.

Catalog agents get badges by domain (Engineering → code, Security → shield, Data → database, Support → chat, Finance → dollar…). Factory crew: Triage → alert, Root-cause → search, Fix → wrench, Review → check, Release → rocket, Watch → eye, Advocate → chat, Strategist → compass, Architect → flows, Builder → code. Edit any agent to change its badge.

## Crew states
| State | When | Motion |
|---|---|---|
| `idle` | Default | Breathing, random blinks, glance around |
| `waving` | Hover, greeting | Wiggle |
| `thinking` | Waiting to start, routing, awaiting approval | Eyes up, thought bubbles |
| `working` | Model call in flight | Bounce with sparkles |
| `tool` | MCP tool call | Spinning gear |
| `talking` | Output arriving | Mouth moves |
| `happy` | Run succeeded / accepted | Jump, happy eyes, heart |
| `sad` | Failed, rejected or cancelled | Droop, frown, tear |
| `sleeping` | Empty states | Closed eyes, Zzz |

## Voice
Short, plain and warm. Say what happened and what to do next ("That code didn’t work. Check your authenticator app’s clock and try again."). No blame, no jargon in user-facing errors.
