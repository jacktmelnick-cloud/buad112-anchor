# Design

## World

The exam blue book and the red pen that grades it. Every college student knows both by heart.
The setup screen is the book's cover, the running session is an open ruled page, and the summary
is the cover handed back with a grade on it. Navy ink means studying. Red pen means phone: anything
caused by phone use is written, circled, or checked in red, and nothing else is.

Scene: a student at a library table under even daylight or fluorescent light, and a classroom
projector during the demo. Light surfaces, high contrast, big numerals that read from the back row.

## Color (Committed: the cover blue owns the ground)

| Token | Value | Role |
|---|---|---|
| `--cover` | `#A9C7EC` | Book cover; the page background on every screen |
| `--cover-shade` | `#93B6E2` | Cover printing, borders on cover |
| `--ink` | `#14284B` | All printed text and primary buttons |
| `--ink-soft` | `#2E4166` | Secondary text on the cover (6:1 on cover) |
| `--pencil` | `#556682` | Secondary text on paper (5.8:1 on paper) |
| `--paper` | `#FCFBF7` | Ruled pages, panels, grade box |
| `--rule` | `#C9DCF1` | Ruled lines |
| `--margin` | `#E7969C` | The page's vertical margin line |
| `--pen` | `#D7262E` | Phone time, checks, circles, penalties. Only on paper (5:1); never small red text on the cover |

## Type

- **Archivo** (variable, self-hosted). Condensed (`font-stretch: 62%`, weight 800 to 900) for the cover
  lettering and timers, the way a blue book prints its title. Normal width for UI and body.
  Timers use tabular figures.
- **Kalam 700** is handwriting. Navy when it is what the student wrote (the cover blanks, the course
  name on the page); red when it grades the phone (phone timer, grade, rubric checks, margin notes).

## Components

- **Blanks**: cover inputs are underlined blanks with a printed label to the left, like "Name ______".
- **Ink button**: navy fill, paper text, 10px radius. Outline variant for secondary actions.
- **Rubric**: the escalation ladder printed in the right margin of the page; reached steps get a red
  check, the current one a red-pen circle.
- **Grade box**: a white box on the cover holding the red grade.
- **Phone**: a phone lying on the desk next to the book, rotated a few degrees; it shows a lock
  screen while studying and a scrolling feed while on the phone.

## Motion

One authored moment: the page settles onto the desk when a session starts. Red pen marks draw in
(stroke-dashoffset) when a step is reached. Everything respects `prefers-reduced-motion`.

## Effects layer

Mac-wide effects come from the native overlay (red pulse, gray drain, blur and shake, floating timer).
If the overlay is unavailable the page falls back to drawing the same effects inside the tab.
Red pulses never exceed 1 flash per 1.2 s.
