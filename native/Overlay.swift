// Anchor overlay helper.
// Draws the "you're on your phone" punishment over every app, Space, and display:
// a red pulse, a gray drain, a behind-window blur that shakes, a floating timer with an
// "I'm off my phone" button, the fake snitch text, and the confession popup.
//
// Protocol: one JSON frame per line on stdin (see src/effects.js overlayFrame).
// Events go out as JSON lines on stdout: {"e":"ready"}, {"e":"off"}, {"e":"confess","text":"..."}.
//
// Safety: the screen must never stay red after the server stops. The process exits straight from
// the reader thread when stdin closes, and a watchdog on a background queue exits after 5 seconds
// without a valid frame, even if the main thread is stuck. Unreadable frames fail closed (clear the
// screen) and never count as a heartbeat. Everything except the two panels is click-through.

import AppKit
import CoreText
import QuartzCore

// MARK: - Protocol

struct Frame: Decodable {
    let active: Bool
    let phoneText: String?
    let levelNumber: Int?
    let levelCount: Int?
    let levelName: String?
    let costText: String?
    let penaltyText: String?
    let pulseAlpha: Double
    let pulsePeriodMs: Double?
    let dim: Double
    let blur: Double
    let shake: Bool
    let snitchPhase: String?
    let snitchSeconds: Int?
    let snitchMessage: String?
    let confession: String?

    static let cleared = Frame(active: false, phoneText: nil, levelNumber: nil, levelCount: nil, levelName: nil,
                               costText: nil, penaltyText: nil, pulseAlpha: 0, pulsePeriodMs: nil, dim: 0, blur: 0,
                               shake: false, snitchPhase: nil, snitchSeconds: nil, snitchMessage: nil, confession: nil)

    enum CodingKeys: String, CodingKey {
        case active, phoneText, levelNumber, levelCount, levelName, costText, penaltyText, pulseAlpha, pulsePeriodMs
        case dim, blur, shake, snitchPhase, snitchSeconds, snitchMessage, confession
    }

    init(active: Bool, phoneText: String?, levelNumber: Int?, levelCount: Int?, levelName: String?, costText: String?,
         penaltyText: String?, pulseAlpha: Double, pulsePeriodMs: Double?, dim: Double, blur: Double, shake: Bool,
         snitchPhase: String?, snitchSeconds: Int?, snitchMessage: String?, confession: String?) {
        self.active = active
        self.phoneText = phoneText
        self.levelNumber = levelNumber
        self.levelCount = levelCount
        self.levelName = levelName
        self.costText = costText
        self.penaltyText = penaltyText
        self.pulseAlpha = pulseAlpha
        self.pulsePeriodMs = pulsePeriodMs
        self.dim = dim
        self.blur = blur
        self.shake = shake
        self.snitchPhase = snitchPhase
        self.snitchSeconds = snitchSeconds
        self.snitchMessage = snitchMessage
        self.confession = confession
    }

    /// Missing visual fields default to "off" and every intensity is clamped, so a partial frame can't stick.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let unit = { (key: CodingKeys) -> Double in min(1, max(0, (try? c.decodeIfPresent(Double.self, forKey: key)) ?? 0)) }
        active = (try? c.decodeIfPresent(Bool.self, forKey: .active)) ?? false
        phoneText = try? c.decodeIfPresent(String.self, forKey: .phoneText)
        levelNumber = try? c.decodeIfPresent(Int.self, forKey: .levelNumber)
        levelCount = try? c.decodeIfPresent(Int.self, forKey: .levelCount)
        levelName = try? c.decodeIfPresent(String.self, forKey: .levelName)
        costText = try? c.decodeIfPresent(String.self, forKey: .costText)
        penaltyText = try? c.decodeIfPresent(String.self, forKey: .penaltyText)
        pulseAlpha = unit(.pulseAlpha)
        pulsePeriodMs = (try? c.decodeIfPresent(Double.self, forKey: .pulsePeriodMs)).flatMap { $0 }.map { max(1200, $0) }
        dim = unit(.dim)
        blur = unit(.blur)
        shake = (try? c.decodeIfPresent(Bool.self, forKey: .shake)) ?? false
        snitchPhase = try? c.decodeIfPresent(String.self, forKey: .snitchPhase)
        snitchSeconds = try? c.decodeIfPresent(Int.self, forKey: .snitchSeconds)
        snitchMessage = try? c.decodeIfPresent(String.self, forKey: .snitchMessage)
        confession = try? c.decodeIfPresent(String.self, forKey: .confession)
    }
}

/// Write one event line. If the server stopped reading, there is nothing left to draw for: exit.
func emit(_ object: [String: String]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8),
          let bytes = (line + "\n").data(using: .utf8) else { return }
    do {
        try FileHandle.standardOutput.write(contentsOf: bytes)
    } catch {
        exit(0)
    }
}

// MARK: - Watchdog (independent of the main thread)

final class Watchdog {
    private static let limit: TimeInterval = 5
    private let lock = NSLock()
    private var last = Date()
    private let timer: DispatchSourceTimer

    init() {
        timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if self.secondsSinceFeed() > Self.limit { exit(0) }
        }
        timer.resume()
    }

    func feed() {
        lock.lock()
        last = Date()
        lock.unlock()
    }

    private func secondsSinceFeed() -> TimeInterval {
        lock.lock()
        defer { lock.unlock() }
        return Date().timeIntervalSince(last)
    }
}

// MARK: - Look

enum Palette {
    static let paper = NSColor(srgbRed: 0.988, green: 0.984, blue: 0.969, alpha: 1)   // #FCFBF7
    static let ink = NSColor(srgbRed: 0.078, green: 0.157, blue: 0.294, alpha: 1)     // #14284B
    static let pen = NSColor(srgbRed: 0.843, green: 0.149, blue: 0.180, alpha: 1)     // #D7262E
    static let pencil = NSColor(srgbRed: 0.333, green: 0.400, blue: 0.510, alpha: 1)  // #556682
    static let drain = NSColor(srgbRed: 0.231, green: 0.247, blue: 0.282, alpha: 1)
    static let bubble = NSColor(srgbRed: 0.039, green: 0.478, blue: 1.0, alpha: 1)
}

enum Fonts {
    static func pen(_ size: CGFloat) -> NSFont {
        NSFont(name: "Kalam-Bold", size: size) ?? .systemFont(ofSize: size, weight: .heavy)
    }
    static func ui(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSFont {
        .systemFont(ofSize: size, weight: weight)
    }
}

func registerFonts(in directory: String) {
    guard !directory.isEmpty else { return }
    let url = URL(fileURLWithPath: directory).appendingPathComponent("kalam-700.ttf")
    CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
}

func label(_ text: String, font: NSFont, color: NSColor) -> NSTextField {
    let field = NSTextField(labelWithString: text)
    field.font = font
    field.textColor = color
    field.lineBreakMode = .byTruncatingTail
    return field
}

func card(size: NSSize) -> NSView {
    let view = NSView(frame: NSRect(origin: .zero, size: size))
    view.wantsLayer = true
    view.layer?.backgroundColor = Palette.paper.cgColor
    view.layer?.cornerRadius = 14
    view.layer?.borderWidth = 1
    view.layer?.borderColor = Palette.ink.withAlphaComponent(0.14).cgColor
    return view
}

/// Clicks land on the first try even though the panel never activates the app.
final class FirstClickButton: NSButton {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

func inkButton(_ title: String, filled: Bool, target: AnyObject, action: Selector) -> NSButton {
    let button = FirstClickButton(title: title, target: target, action: action)
    button.isBordered = false
    button.wantsLayer = true
    button.layer?.cornerRadius = 10
    button.layer?.backgroundColor = filled ? Palette.ink.cgColor : NSColor.clear.cgColor
    button.layer?.borderWidth = filled ? 0 : 1.5
    button.layer?.borderColor = Palette.ink.cgColor
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    button.attributedTitle = NSAttributedString(string: title, attributes: [
        .foregroundColor: filled ? Palette.paper : Palette.ink,
        .font: Fonts.ui(14, .semibold),
        .paragraphStyle: style,
    ])
    return button
}

/// A borderless panel that floats above the overlay on every Space without activating the app.
func floatingPanel<P: NSPanel>(_ kind: P.Type, size: NSSize) -> P {
    let panel = P(contentRect: NSRect(origin: .zero, size: size),
                  styleMask: [.borderless, .nonactivatingPanel],
                  backing: .buffered, defer: false)
    // isFloatingPanel resets the level to .floating, so it must come first.
    panel.isFloatingPanel = true
    panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.animationBehavior = .none
    panel.isReleasedWhenClosed = false
    panel.alphaValue = 0
    return panel
}

/// Fades a panel in or out, and only when its visibility actually changes.
final class Fader {
    private(set) var shown = false
    private let window: NSWindow

    init(_ window: NSWindow) {
        self.window = window
    }

    func set(_ visible: Bool) {
        guard visible != shown else { return }
        shown = visible
        if visible { window.orderFrontRegardless() }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.25
            window.animator().alphaValue = visible ? 1 : 0
        }, completionHandler: { [weak self] in
            guard let self, !self.shown else { return }
            self.window.orderOut(nil)
        })
    }
}

/// The display with the menu bar. Nil only mid-reconfiguration (lid closing, displays sleeping).
var menuBarScreen: NSScreen? { NSScreen.screens.first ?? NSScreen.main }

func topCenter(_ size: NSSize, below offset: CGFloat) -> NSPoint? {
    guard let visible = menuBarScreen?.visibleFrame else { return nil }
    return NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - offset)
}

// MARK: - Full-screen layer, one per display

final class ScreenOverlay {
    private static let bleed: CGFloat = 40
    private static let fadeSeconds = 0.6

    let window: NSWindow
    private let stage: NSView
    private let tint: NSView
    private let blurView: NSVisualEffectView
    private let dimLayer = CALayer()
    private let redLayer = CALayer()
    private var pulseKey = ""
    private var shaking = false
    private var active = false

    init(screen: NSScreen) {
        window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.level = .screenSaver
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none

        let root = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        root.wantsLayer = true
        root.autoresizingMask = [.width, .height]
        window.contentView = root

        // Oversized so the shake never reveals an unblurred edge.
        stage = NSView(frame: root.bounds.insetBy(dx: -Self.bleed, dy: -Self.bleed))
        stage.wantsLayer = true
        stage.autoresizingMask = [.width, .height]
        root.addSubview(stage)

        blurView = NSVisualEffectView(frame: stage.bounds)
        blurView.material = .fullScreenUI
        blurView.blendingMode = .behindWindow
        blurView.state = .active
        blurView.appearance = NSAppearance(named: .aqua)
        blurView.alphaValue = 0
        blurView.autoresizingMask = [.width, .height]
        stage.addSubview(blurView)

        // Layer-hosting view: we own these layers, so AppKit never resets their opacity.
        tint = NSView(frame: stage.bounds)
        let host = CALayer()
        tint.layer = host
        tint.wantsLayer = true
        tint.autoresizingMask = [.width, .height]
        for layer in [dimLayer, redLayer] {
            layer.frame = tint.bounds
            layer.opacity = 0
            host.addSublayer(layer)
        }
        dimLayer.backgroundColor = Palette.drain.cgColor
        redLayer.backgroundColor = Palette.pen.cgColor
        stage.addSubview(tint)

        place(on: screen)
    }

    func place(on screen: NSScreen) {
        window.setFrame(screen.frame, display: false)
        let bounds = stage.bounds
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        dimLayer.frame = bounds
        redLayer.frame = bounds
        CATransaction.commit()
    }

    func apply(_ frame: Frame, reduceTransparency: Bool) {
        let blur = reduceTransparency ? 0 : frame.blur
        // With Reduce Transparency on, the blur would render solid; deepen the drain instead.
        let dim = reduceTransparency ? min(0.6, frame.dim + frame.blur * 0.25) : frame.dim
        let becameActive = frame.active && !active
        active = frame.active
        if frame.active { window.orderFrontRegardless() }

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = Self.fadeSeconds
            blurView.animator().alphaValue = CGFloat(blur)
        }, completionHandler: { [weak self] in
            // Idle full-screen windows still cost compositing; take them off screen once faded.
            guard let self, !self.active else { return }
            self.window.orderOut(nil)
        })
        CATransaction.begin()
        CATransaction.setAnimationDuration(Self.fadeSeconds)
        dimLayer.opacity = Float(dim)
        CATransaction.commit()
        updatePulse(alpha: frame.pulseAlpha, periodMs: frame.pulsePeriodMs, force: becameActive)
        updateShake(frame.shake)
    }

    private func updatePulse(alpha: Double, periodMs: Double?, force: Bool) {
        let key = "\(alpha)|\(periodMs ?? 0)"
        guard key != pulseKey || force else { return }
        pulseKey = key
        redLayer.removeAnimation(forKey: "pulse")
        redLayer.opacity = 0
        guard alpha > 0, let period = periodMs, period > 0 else { return }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 0
        pulse.toValue = alpha
        pulse.duration = period / 2000
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        redLayer.add(pulse, forKey: "pulse")
    }

    private func updateShake(_ on: Bool) {
        guard on != shaking, let layer = stage.layer else { return }
        shaking = on
        guard on else {
            layer.removeAnimation(forKey: "shake")
            return
        }
        let x = CAKeyframeAnimation(keyPath: "transform.translation.x")
        x.values = [0, -10, 8, -6, 11, -8, 5, 0]
        x.duration = 0.62
        let y = CAKeyframeAnimation(keyPath: "transform.translation.y")
        y.values = [0, 6, -7, 4, -5, 7, -3, 0]
        y.duration = 0.62
        let group = CAAnimationGroup()
        group.animations = [x, y]
        group.duration = 0.62
        group.repeatCount = .infinity
        layer.add(group, forKey: "shake")
    }

    func close() {
        window.orderOut(nil)
        window.close()
    }
}

// MARK: - Floating timer with the off button

final class HUD {
    static let size = NSSize(width: 580, height: 84)

    let panel: NSPanel
    private let fader: Fader
    private let time = label("0:00", font: Fonts.pen(38), color: Palette.pen)
    private let caption = label("on your phone", font: Fonts.ui(11, .semibold), color: Palette.pencil)
    private let step = label("", font: Fonts.ui(15, .semibold), color: Palette.ink)
    private let detail = label("", font: Fonts.ui(12), color: Palette.pencil)

    init(target: AnyObject, offAction: Selector) {
        panel = floatingPanel(NSPanel.self, size: Self.size)
        fader = Fader(panel)
        let body = card(size: Self.size)
        panel.contentView = body

        time.frame = NSRect(x: 22, y: 22, width: 118, height: 50)
        caption.frame = NSRect(x: 24, y: 10, width: 118, height: 16)

        let rule = NSView(frame: NSRect(x: 148, y: 16, width: 1.5, height: 52))
        rule.wantsLayer = true
        rule.layer?.backgroundColor = Palette.pen.withAlphaComponent(0.55).cgColor

        step.frame = NSRect(x: 166, y: 44, width: 236, height: 22)
        detail.frame = NSRect(x: 166, y: 22, width: 236, height: 18)

        let off = inkButton("I'm off my phone", filled: true, target: target, action: offAction)
        off.frame = NSRect(x: 414, y: 20, width: 148, height: 44)

        [time, caption, rule, step, detail, off].forEach(body.addSubview)
    }

    func update(_ frame: Frame) {
        if frame.active {
            time.stringValue = frame.phoneText ?? "0:00"
            step.stringValue = "Step \(frame.levelNumber ?? 1) of \(frame.levelCount ?? 12) · \(frame.levelName ?? "")"
            let extras = [frame.costText, frame.penaltyText].compactMap { $0 }
            detail.stringValue = extras.isEmpty ? "Getting off clears everything." : extras.joined(separator: " · ")
            position()
        }
        fader.set(frame.active)
    }

    func position() {
        if let origin = topCenter(Self.size, below: 14) { panel.setFrameOrigin(origin) }
    }
}

// MARK: - The fake "texting your study group" card

final class SnitchCard {
    static let size = NSSize(width: 400, height: 132)

    let panel: NSPanel
    private let fader: Fader
    private let header = label("To: Study Group (4)   ·   fake, nothing is sent", font: Fonts.ui(12, .semibold), color: Palette.pencil)
    private let countdown = label("", font: Fonts.pen(22), color: Palette.pen)
    private let bubble = NSView()
    private let bubbleText = NSTextField(wrappingLabelWithString: "")
    private let delivered = label("Delivered", font: Fonts.ui(11), color: Palette.pencil)

    init() {
        panel = floatingPanel(NSPanel.self, size: Self.size)
        panel.ignoresMouseEvents = true
        fader = Fader(panel)
        let body = card(size: Self.size)
        panel.contentView = body

        header.frame = NSRect(x: 18, y: 104, width: 364, height: 18)
        countdown.frame = NSRect(x: 18, y: 32, width: 364, height: 50)
        countdown.alignment = .center

        bubble.wantsLayer = true
        bubble.layer?.backgroundColor = Palette.bubble.cgColor
        bubble.layer?.cornerRadius = 16
        bubble.frame = NSRect(x: 60, y: 26, width: 322, height: 72)
        bubbleText.font = Fonts.ui(13.5)
        bubbleText.textColor = .white
        bubbleText.frame = bubble.bounds.insetBy(dx: 12, dy: 8)
        bubble.addSubview(bubbleText)
        delivered.frame = NSRect(x: 300, y: 8, width: 82, height: 14)
        delivered.alignment = .right

        [header, countdown, bubble, delivered].forEach(body.addSubview)
    }

    func update(_ frame: Frame) {
        let phase = frame.active ? frame.snitchPhase : nil
        if let phase {
            let sent = phase == "sent"
            countdown.isHidden = sent
            bubble.isHidden = !sent
            delivered.isHidden = !sent
            countdown.stringValue = "Texting your study group in \(frame.snitchSeconds ?? 0)…"
            bubbleText.stringValue = frame.snitchMessage ?? ""
            position()
        }
        fader.set(phase != nil)
    }

    func position() {
        if let origin = topCenter(Self.size, below: HUD.size.height + 28) { panel.setFrameOrigin(origin) }
    }
}

// MARK: - Confession popup (covers the middle of the screen, never the whole screen)

final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class ConfessionPanel {
    static let size = NSSize(width: 540, height: 236)
    static let maxLength = 200

    let panel: KeyPanel
    let field = NSTextField(string: "")
    private let phrase = label("", font: Fonts.pen(26), color: Palette.pen)
    private var showing = false

    init(target: AnyObject, confessAction: Selector, offAction: Selector) {
        panel = floatingPanel(KeyPanel.self, size: Self.size)
        let body = card(size: Self.size)
        panel.contentView = body

        let title = label("Type this to make the popup leave for 30 seconds", font: Fonts.ui(15, .semibold), color: Palette.ink)
        title.frame = NSRect(x: 26, y: 192, width: 488, height: 22)
        phrase.frame = NSRect(x: 26, y: 146, width: 488, height: 40)

        field.frame = NSRect(x: 26, y: 96, width: 488, height: 32)
        field.font = Fonts.ui(16)
        field.placeholderString = "Type the sentence in red (no pasting)"
        field.target = target
        field.action = confessAction
        field.focusRingType = .exterior

        let confess = inkButton("Confess", filled: false, target: target, action: confessAction)
        confess.frame = NSRect(x: 26, y: 26, width: 150, height: 44)
        let off = inkButton("I'm off my phone", filled: true, target: target, action: offAction)
        off.frame = NSRect(x: 340, y: 26, width: 174, height: 44)

        [title, phrase, field, confess, off].forEach(body.addSubview)
    }

    var typed: String { String(field.stringValue.prefix(Self.maxLength)) }

    func update(_ frame: Frame) {
        let wanted = frame.active ? frame.confession : nil
        if let wanted, phrase.stringValue != wanted { phrase.stringValue = wanted }
        guard (wanted != nil) != showing else { return }
        showing = wanted != nil
        if showing {
            field.stringValue = ""
            position()
            panel.alphaValue = 1
            // A non-activating key panel takes keystrokes without stealing app activation.
            panel.makeKeyAndOrderFront(nil)
            panel.makeFirstResponder(field)
        } else {
            panel.orderOut(nil)
        }
    }

    func position() {
        guard let visible = menuBarScreen?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: visible.midX - Self.size.width / 2, y: visible.midY - Self.size.height / 2))
    }
}

// MARK: - Controller

final class Controller: NSObject {
    private var overlays: [CGDirectDisplayID: ScreenOverlay] = [:]
    private var hud: HUD!
    private var snitch: SnitchCard!
    private var confession: ConfessionPanel!
    private var lastFrame = Frame.cleared

    override init() {
        super.init()
        hud = HUD(target: self, offAction: #selector(offPressed))
        snitch = SnitchCard()
        confession = ConfessionPanel(target: self, confessAction: #selector(confessPressed), offAction: #selector(offPressed))
        syncScreens()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    func apply(_ frame: Frame) {
        lastFrame = frame
        let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        overlays.values.forEach { $0.apply(frame, reduceTransparency: reduce) }
        hud.update(frame)
        snitch.update(frame)
        confession.update(frame)
    }

    /// Keep one overlay per display: reuse the ones that still exist, add new displays, drop removed ones.
    private func syncScreens() {
        let screens = NSScreen.screens.compactMap { screen -> (CGDirectDisplayID, NSScreen)? in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
            return (CGDirectDisplayID(number.uint32Value), screen)
        }
        let live = Set(screens.map(\.0))
        overlays.filter { !live.contains($0.key) }.forEach { id, overlay in
            overlay.close()
            overlays[id] = nil
        }
        for (id, screen) in screens {
            if let existing = overlays[id] {
                existing.place(on: screen)
            } else {
                overlays[id] = ScreenOverlay(screen: screen)
            }
        }
    }

    @objc private func screensChanged() {
        syncScreens()
        hud.position()
        snitch.position()
        confession.position()
        apply(lastFrame) // redraw only; this is not a heartbeat
    }

    @objc private func offPressed() {
        emit(["e": "off"])
    }

    @objc private func confessPressed() {
        emit(["e": "confess", "text": confession.typed])
        confession.field.stringValue = ""
    }
}

// MARK: - Main

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
registerFonts(in: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "")
let watchdog = Watchdog()
let controller = Controller()

let reader = Thread {
    let decoder = JSONDecoder()
    while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8), let frame = try? decoder.decode(Frame.self, from: data) else {
            // Fail closed: clear the screen and do not feed the watchdog.
            FileHandle.standardError.write("anchor-overlay: unreadable frame, clearing\n".data(using: .utf8)!)
            DispatchQueue.main.async { controller.apply(.cleared) }
            continue
        }
        watchdog.feed()
        DispatchQueue.main.async { controller.apply(frame) }
    }
    // stdin closed: the server is gone. Exit from here so a stuck main thread can't keep the screen red.
    exit(0)
}
reader.start()

emit(["e": "ready"])
app.run()
