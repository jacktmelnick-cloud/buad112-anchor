# Anchor

A study timer you can't quietly quit. BUAD112 MVP.

You drop an anchor where you study. While you're within 50 m of it, **Stop is locked**.
Every 15 seconds you spend on your phone, your Mac gets more annoying, across every app,
tab, and screen, until getting off the phone is the easiest thing to do.

## Run it

Needs a Mac, Node 20 or newer, and Apple's command line tools (`xcode-select --install`, for
the screen overlay).

```bash
cd ~/buad112-anchor
npm start
```

Open **http://localhost:5112** in Chrome or Safari and allow location when asked.
The first start compiles the screen overlay (a few seconds).

## The rubric (one step per 15 s on your phone)

| On phone | Step | What happens on the Mac |
|---|---|---|
| 0:00 | Clock | Floating timer with an "I'm off my phone" button appears over every app |
| 0:15 | Red pulse | Whole screen pulses red (slow, never faster than once per 1.2 s) |
| 0:30 | Ticking | Clock ticking that speeds up; volume is unmuted and raised to at least 35 |
| 0:45 | Blur | The whole screen blurs in waves (about 2.5 s blurred, 3 s clear); waves get longer and gaps shorter each step, never under 1.5 s clear |
| 1:00 | Shake | Every blur wave also vibrates and shudders the whole screen like a phone buzzing on a table, harder every step |
| 1:15 | Receipt | Tuition burned, counted live |
| 1:30 | Voice | The Mac talks to you every 15 s |
| 1:45 | Notifications | A banner every 10 s |
| 2:00 | Penalty | Each phone second adds 2 s to the study timer |
| 2:15 | Snitch | "Texting your study group in 10…" then a fake sent message. Nothing is sent |
| 2:30 | Siren | Siren loop, volume forced to at least 70 |
| 2:45 | Confession | A popup you make leave by typing "I am choosing my phone over my grade" (buys 30 s) |

The shake moves a blurred snapshot of your whole screen, so it needs Screen Recording permission for
the app you run `npm start` from (Terminal already has it on Sam's Mac). Without it, only the screen
edges rattle, and Anchor prints how to turn it on.

**Tuition:** the cover asks for your college's yearly tuition and turns it into what one minute of class
costs: tuition ÷ 450 class hours a year (15 hours a week, two 15-week semesters). $70,000 a year comes
out to $2.59 a minute.

Getting off the phone clears everything instantly and puts your volume back exactly as it was.
The phone timer and the punishment run on one clock (step = timer ÷ 15 s), and it never resets during a
session. Off the phone, it pauses; pick the phone up again and it resumes at the same step. Only a new
session starts from zero.

**Away from your anchor** (past the point where Stop unlocks), your phone is just a phone: nothing goes
off, nothing is charged, and the study timer pauses. Press Stop there, or walk back and keep studying.
Coming back while still on your phone resumes the timer and step exactly where you left them.
Closing the tab doesn't end the session; the server keeps it, and reopening the page picks it up.

## Demoing to the class

Open **Presenter** (bottom left):

- **6x speed**: each step takes 2.5 seconds instead of 15, so the whole rubric plays in about 30 seconds.
- **Walk away slider**: pretend you're N meters from the anchor. Past 50 m, Stop unlocks.

Suggested 2-minute demo: start a 5-minute session at 1x and hit "I'm on my phone". At real speed it goes
red at 0:15, ticks at 0:30, blurs at 0:45, and shakes the whole screen at 1:00. Switch to 6x to rush the rest
up to the siren, click "I'm off my phone" on the floating bar, then slide "Walk away" to 70 m and press Stop
to show the graded cover.

## Safety exits

- "I'm off my phone" is always on screen (floating bar, top center) and works from any app.
- `Ctrl+C` in the Terminal running `npm start` stops everything and restores your volume.
- If the server dies, the overlay removes itself within 5 seconds.
- Nothing ever blocks the whole screen; the confession popup covers only the middle.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `5112` | Port for the page |
| `ANCHOR_SILENT=1` | off | No sound, speech, or volume changes |
| `ANCHOR_OVERLAY=0` | on | Skip the Mac overlay; the page draws the effects inside the tab instead |
| `ANCHOR_DATA` | `./data` | Where the session is saved |

## Tests

```bash
npm test        # unit and API tests
npm run coverage
npm run e2e     # full flow in a real browser (silent, no overlay); pass a folder to keep screenshots
```

## How it's built

- `src/engine.js`: the rules, as pure functions (timers, escalation, decay, penalty, geofence, grade).
- `src/effects.js`: decides which effects are due and what the overlay should draw.
- `src/mac.js`: runs them with built-in macOS tools (`afplay`, `say`, `osascript`).
- `native/Overlay.swift`: the full-screen overlay and floating panels, driven over stdin.
- `src/server.js`: localhost only, same-origin JSON only, live updates over server-sent events.
- `public/`: the page, designed as an exam blue book (see `DESIGN.md`).
