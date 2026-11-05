# Anchor

A study timer you can't quietly quit. BUAD112 MVP.

You drop an anchor where you study. While you're within 50 m of it, **Stop is locked**.
Every 30 seconds you spend on your phone, your Mac gets more annoying, across every app,
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

## The rubric (one step per 30 s on your phone)

| On phone | Step | What happens on the Mac |
|---|---|---|
| 0:00 | Clock | Floating timer with an "I'm off my phone" button appears over every app |
| 0:30 | Red pulse | Whole screen pulses red (slow, never faster than once per 1.2 s) |
| 1:00 | Ticking | Clock ticking that speeds up; volume is unmuted and raised to at least 35 |
| 1:30 | Drain | Screen dims to gray |
| 2:00 | Receipt | Tuition burned, counted live |
| 2:30 | Voice | The Mac talks to you every 15 s |
| 3:00 | Blur and shake | Every app blurs until unreadable and the screen wobbles |
| 3:30 | Notifications | A banner every 10 s |
| 4:00 | Penalty | Each phone second adds 2 s to the study timer |
| 4:30 | Snitch | "Texting your study group in 10…" then a fake sent message. Nothing is sent |
| 5:00 | Siren | Siren loop, volume forced to at least 70 |
| 5:30 | Confession | A popup you make leave by typing "I am choosing my phone over my grade" (buys 30 s) |

Getting off the phone clears everything instantly and puts your volume back exactly as it was.
The step you reached cools down one step per 30 s, so quick off-and-on toggles don't reset it.
Closing the tab doesn't end the session; the server keeps it, and reopening the page picks it up.

## Demoing to the class

Open **Presenter** (bottom left):

- **6x speed**: each step takes 5 seconds instead of 30, so the whole rubric plays in about a minute.
- **Walk away slider**: pretend you're N meters from the anchor. Past 50 m, Stop unlocks.

Suggested 2-minute demo: start a 5-minute session, switch to 6x, hit "I'm on my phone", let it climb
to the siren, click "I'm off my phone" on the floating bar, then slide "Walk away" to 70 m and press Stop
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
npm test        # 97 unit and API tests
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
