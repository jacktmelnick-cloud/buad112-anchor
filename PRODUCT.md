# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
College students studying solo at a library, dorm, or cafe with their phone within reach. They start a study block, then lose minutes to their phone without noticing. In the class demo, the audience is a BUAD112 section watching a live walkthrough.

## Product Purpose
Anchor is a study timer you cannot quietly quit. You drop an anchor where you study; while you are within 50 m of it, Stop is locked. Every 15 seconds you spend on your phone during the session, the device gets more annoying, until getting off the phone is the easiest thing to do. Success: phone time per session goes down, and sessions end because the timer finished, not because the user gave up.

## Positioning
Other study timers and focus apps can be switched off from the same device that is distracting you. Anchor ties the off switch to a physical place: the only way to stop early is to walk away from the spot. Escalation punishes staying on the phone, never getting off it.

## Operating Context
- Class MVP that runs on localhost on a Mac. A test button ("I'm on my phone") stands in for actually picking up a phone; the Mac plays the part of the phone.
- Effects reach the whole Mac, not just the browser tab: a native overlay pulses the screen red, blurs it, shakes the whole screen, plays sound, speaks, and posts notifications in any app or tab.
- Presented live to a class, so a demo-speed control and a "simulate walking away" control exist for the presenter.

## Capabilities and Constraints
- Study timer (user sets minutes), separate phone timer, 50 m geofence via browser location, Stop locked inside the radius.
- Escalation ladder, one step per 15 s on the phone, in this order: red pulse, ticking, blur, full-screen shake, then the rest. Effects stack; the "I'm off my phone" control is always one click away and clears every effect at once.
- One clock for the phone timer and the punishment (step = timer / 15 s). It never resets during a session: off the phone or away it pauses, and it resumes where it left off. Only a new session starts from zero.
- Away from the anchor (past the Stop unlock distance) the phone is free: no effects, no penalty, no cost, and the study timer pauses. Stop is available there, or the user walks back and continues.
- The cost counter comes from the college's yearly tuition the user enters, divided by 450 class hours a year (27,000 minutes).
- Session state lives on the local server, so closing the tab does not end it.
- Confirmed by the team: no full-screen lockout that blocks the Mac; the snitch text is faked on screen and nothing is sent.
- Undecided: product name ("Anchor" is a working name).

## Brand Commitments
None yet. Voice: blunt and funny about phone use, never cruel about the person.

## Evidence on Hand
No users, metrics, or testimonials exist. The tuition cost counter uses the yearly tuition the user types in; it is not a claim about any school's tuition.

## Product Principles
1. Getting off the phone is always the easiest action on screen.
2. The annoyance is earned by time on the phone, never by the clock alone.
3. Commitment is physical: place, not willpower.
4. Nothing leaves the device without the user's explicit setup.

## Accessibility & Inclusion
Red pulses stay well under 3 flashes per second (WCAG 2.3.1). Every effect stops immediately when the user gets off the phone or the session ends.
