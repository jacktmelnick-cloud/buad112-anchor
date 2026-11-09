# iPhone Shortcuts setup

About 15 minutes, once. After that, the only thing that changes before each demo is the URL and key in one Shortcut.

You need: an iPhone (iOS 17 or newer) and the Mac running `npm start`. The Mac prints a `https://….trycloudflare.com` URL and shows a QR code on the Anchor page.

## 0. One-time iPhone setting

Settings, Accessibility, Display & Text Size, Color Filters. Choose **Grayscale**, but leave Color Filters **OFF**. The Shortcut turns it on and off.

## 1. Shortcut "Anchor Config"

1. Shortcuts app, tap **+**, name it **Anchor Config**.
2. Add **Dictionary**. Add two Text items:
   - `base` = the URL from `npm start` (like `https://something.trycloudflare.com`, no slash at the end)
   - `key` = the key shown on the Mac page under the QR code
3. Add **Stop and Output**, and output the Dictionary.

Before each demo, this is the only thing you edit.

## 2. Automation 1: "App is Opened"

Shortcuts, Automation tab, **+**, **App**. Tick **Is Opened** and choose Instagram, TikTok, etc. Choose **Run Immediately**. Then Next, **Create New Shortcut** and add these actions in order:

1. **Run Shortcut**: Anchor Config.
2. **Get Contents of URL**: URL `[base]/api/phone/open` (tap the URL field, insert the Shortcut Result's `base` value, then type `/api/phone/open`).
   - Show More: Method **POST**
   - Headers: `x-anchor-key` = `[key]`
   - Request Body **JSON**: add Text `app` = `Instagram`
   - Optional: add `lat` and `lng` from **Get Current Location** then **Get Details of Location**. This adds a second or two of delay.
3. **Get Dictionary Value**: `data`, from the Contents of URL.
4. **If** `grayscale` (Dictionary Value from `data`) **is** true: **Set Color Filters** On. **Otherwise**: Set Color Filters Off. End If.
5. **Set Brightness** to `brightnessPercent` percent (from `data`).
6. **If** `gate` is true: **Open URLs** `[base]/phone.html?k=[key]#gate`. End If.

Finish. Back on the automation screen, make sure **Notify When Run** is OFF.

Make one automation per app, or tick several apps in one automation (change `app` text to match if you like; the name is only a label).

## 3. Automation 2: "App is Closed"

Same apps, trigger **Is Closed**, Run Immediately, Notify off.

1. Run Shortcut: Anchor Config.
2. Get Contents of URL: `[base]/api/phone/close`, POST, header `x-anchor-key: [key]`, JSON body `app` = `Instagram`.
3. Set Color Filters **Off**.
4. Set Brightness **60%**.

## 4. Optional Automation 3: "Leave"

Trigger **Arrive/Leave**, Leave, your study spot, Run Immediately. Actions: Set Color Filters Off, Set Brightness 60%.

## Troubleshooting

- **No tunnel URL printed:** `cloudflared` is missing. `brew install cloudflared`, restart `npm start`. Wait about 10 seconds.
- **403 or "Wrong key":** the key in Anchor Config does not match the one on the Mac page. Retype it, no spaces.
- **Automation asks "Run?" every time:** open the automation, turn on **Run Immediately**.
- **Nothing happens at all:** a session must be running, and you must be inside 50 m of the anchor. Use the Presenter sliders to check.
- **Screen stuck grey or dim:** open the "App is Closed" automation's shortcut and run it, or turn Color Filters off in Settings.
- **No Shortcuts at all:** open `/phone.html?k=KEY` and use Presenter, "Simulate opening Instagram".

## Demo script (2 minutes)

1. Projector shows the Mac Anchor page with the QR code. Scan it with your iPhone; the phone page opens.
2. On the phone: set 5 minutes, tuition, a play-money deposit. Tap **Drop anchor & start**.
3. Presenter on the phone: demo speed **5x**.
4. Open Instagram. You are bounced to the gate. Wait out the countdown. Say what is happening.
5. Keep opening it. The phone goes **grey**, then **dim**, then the gate shows **tuition burned**, then demands the **confession**.
6. Walk away, or drag Simulated distance past 50 m. **Stop** unlocks. Press it and show the grade.
