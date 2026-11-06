// Anchor overlay helper.
// Draws the "you're on your phone" punishment over every app, Space, and display:
// a red pulse, a behind-window blur, a full-screen vibration, a floating timer with an
// "I'm off my phone" button, the fake snitch text, and the confession popup.
//
// The vibration: a behind-window blur can't move what's under it, so at the shake step the helper
// snapshots each display about once a second (ScreenCaptureKit, excluding its own windows), blurs the
// snapshot, and jolts it around a black backdrop. Without Screen Recording permission it falls back
// to a jittering black frame around the screen edges and reports that once.
//
// Protocol: one JSON frame per line on stdin (see src/effects.js overlayFrame).
// Events go out as JSON lines on stdout: {"e":"ready"}, {"e":"off"}, {"e":"confess","text":"..."},
// {"e":"notice","text":"..."}.
//
// Safety: the screen must never stay red after the server stops. The process exits straight from
// the reader thread when stdin closes, and a watchdog on a background queue exits after 5 seconds
// without a valid frame, even if the main thread is stuck. Unreadable frames fail closed (clear the
// screen) and never count as a heartbeat. Everything except the two panels is click-through.

import AppKit
import CoreImage
import CoreText
import QuartzCore
import ScreenCaptureKit

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
    let blur: Double
    let shakeAmp: Double
    let shakeReady: Bool
    let depositLeft: Double?
    let depositTotal: Double?
    let snitchPhase: String?
    let snitchSeconds: Int?
    let snitchMessage: String?
    let confession: String?

    static let maxShake: Double = 40

    static let cleared = Frame(active: false, phoneText: nil, levelNumber: nil, levelCount: nil, levelName: nil,
                               costText: nil, penaltyText: nil, pulseAlpha: 0, pulsePeriodMs: nil, blur: 0,
                               shakeAmp: 0, shakeReady: false, depositLeft: nil, depositTotal: nil, snitchPhase: nil,
                               snitchSeconds: nil, snitchMessage: nil, confession: nil)

    enum CodingKeys: String, CodingKey {
        case active, phoneText, levelNumber, levelCount, levelName, costText, penaltyText, pulseAlpha, pulsePeriodMs
        case blur, shakeAmp, shakeReady, depositLeft, depositTotal, snitchPhase, snitchSeconds, snitchMessage, confession
    }

    init(active: Bool, phoneText: String?, levelNumber: Int?, levelCount: Int?, levelName: String?, costText: String?,
         penaltyText: String?, pulseAlpha: Double, pulsePeriodMs: Double?, blur: Double, shakeAmp: Double,
         shakeReady: Bool, depositLeft: Double?, depositTotal: Double?, snitchPhase: String?, snitchSeconds: Int?,
         snitchMessage: String?, confession: String?) {
        self.active = active
        self.phoneText = phoneText
        self.levelNumber = levelNumber
        self.levelCount = levelCount
        self.levelName = levelName
        self.costText = costText
        self.penaltyText = penaltyText
        self.pulseAlpha = pulseAlpha
        self.pulsePeriodMs = pulsePeriodMs
        self.blur = blur
        self.shakeAmp = shakeAmp
        self.shakeReady = shakeReady
        self.depositLeft = depositLeft
        self.depositTotal = depositTotal
        self.snitchPhase = snitchPhase
        self.snitchSeconds = snitchSeconds
        self.snitchMessage = snitchMessage
        self.confession = confession
    }

    /// Missing visual fields default to "off" and every intensity is clamped, so a partial frame can't stick.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let number = { (key: CodingKeys) -> Double in (try? c.decodeIfPresent(Double.self, forKey: key)).flatMap { $0 } ?? 0 }
        active = (try? c.decodeIfPresent(Bool.self, forKey: .active)).flatMap { $0 } ?? false
        phoneText = (try? c.decodeIfPresent(String.self, forKey: .phoneText)).flatMap { $0 }
        levelNumber = (try? c.decodeIfPresent(Int.self, forKey: .levelNumber)).flatMap { $0 }
        levelCount = (try? c.decodeIfPresent(Int.self, forKey: .levelCount)).flatMap { $0 }
        levelName = (try? c.decodeIfPresent(String.self, forKey: .levelName)).flatMap { $0 }
        costText = (try? c.decodeIfPresent(String.self, forKey: .costText)).flatMap { $0 }
        penaltyText = (try? c.decodeIfPresent(String.self, forKey: .penaltyText)).flatMap { $0 }
        pulseAlpha = min(1, max(0, number(.pulseAlpha)))
        pulsePeriodMs = (try? c.decodeIfPresent(Double.self, forKey: .pulsePeriodMs)).flatMap { $0 }.map { max(1200, $0) }
        blur = min(1, max(0, number(.blur)))
        shakeAmp = min(Self.maxShake, max(0, number(.shakeAmp)))
        shakeReady = (try? c.decodeIfPresent(Bool.self, forKey: .shakeReady)).flatMap { $0 } ?? false
        depositLeft = (try? c.decodeIfPresent(Double.self, forKey: .depositLeft)).flatMap { $0 }.map { max(0, $0) }
        depositTotal = (try? c.decodeIfPresent(Double.self, forKey: .depositTotal)).flatMap { $0 }.map { max(0, $0) }
        snitchPhase = (try? c.decodeIfPresent(String.self, forKey: .snitchPhase)).flatMap { $0 }
        snitchSeconds = (try? c.decodeIfPresent(Int.self, forKey: .snitchSeconds)).flatMap { $0 }
        snitchMessage = (try? c.decodeIfPresent(String.self, forKey: .snitchMessage)).flatMap { $0 }
        confession = (try? c.decodeIfPresent(String.self, forKey: .confession)).flatMap { $0 }
    }

    var shaking: Bool { active && shakeAmp > 0 }
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
    static let shade = NSColor(srgbRed: 0.231, green: 0.247, blue: 0.282, alpha: 1)
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

func displayID(of screen: NSScreen) -> CGDirectDisplayID? {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { CGDirectDisplayID($0.uint32Value) }
}

// MARK: - Screen snapshots for the vibration

final class ScreenSnapper {
    private static let interval: TimeInterval = 1.0
    private static let blurSigma: Double = 14
    /// A capture that hasn't finished in this long is treated as lost, so the loop recovers.
    private static let stuckAfter: TimeInterval = 5

    private let context = CIContext()
    private var timer: Timer?
    private var busy = false
    private var busySince: Date?
    private var reportedDenied = false
    var onImage: ((CGDirectDisplayID, CGImage) -> Void)?

    var running: Bool { timer != nil }

    func start() {
        guard timer == nil else { return }
        guard CGPreflightScreenCaptureAccess() else {
            if !reportedDenied {
                reportedDenied = true
                emit(["e": "notice", "text": "Screen Recording is off for the app running Anchor, so the shake only rattles the screen edges. Turn it on in System Settings > Privacy & Security > Screen Recording, then restart Anchor."])
            }
            return
        }
        capture()
        timer = Timer.scheduledTimer(withTimeInterval: Self.interval, repeats: true) { [weak self] _ in self?.capture() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func capture() {
        if busy, let since = busySince, Date().timeIntervalSince(since) < Self.stuckAfter { return }
        busy = true
        busySince = Date()
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [weak self] content, _ in
            guard let self else { return }
            guard let content else {
                DispatchQueue.main.async { self.busy = false }
                return
            }
            let mine = content.applications.filter { $0.processID == getpid() }
            let group = DispatchGroup()
            for display in content.displays {
                let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])
                let config = SCStreamConfiguration()
                config.width = display.width
                config.height = display.height
                config.showsCursor = false
                group.enter()
                SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, _ in
                    defer { group.leave() }
                    guard let image, let blurred = self.blurred(image) else { return }
                    let id = display.displayID
                    DispatchQueue.main.async { if self.running { self.onImage?(id, blurred) } }
                }
            }
            group.notify(queue: .main) { self.busy = false }
        }
    }

    private func blurred(_ image: CGImage) -> CGImage? {
        let source = CIImage(cgImage: image)
        let output = source.clampedToExtent().applyingGaussianBlur(sigma: Self.blurSigma).cropped(to: source.extent)
        return context.createCGImage(output, from: source.extent)
    }
}

// MARK: - Full-screen layer, one per display

final class ScreenOverlay {
    private static let bleed: CGFloat = 60
    private static let fadeSeconds = 0.6
    /// Offsets (in units of the amplitude) for one 0.36 s buzz cycle: fast jitter plus two hard lurches.
    private static let buzz: [(Double, Double)] = [
        (0.3, -0.2), (-0.35, 0.25), (1, -0.5), (-0.3, 0.3), (0.25, 0.35), (-0.4, -0.2),
        (0.35, 0.15), (-1, 0.6), (0.3, -0.35), (-0.25, 0.2), (0.4, -0.3), (-0.3, -0.25),
    ]

    let window: NSWindow
    private let blurView: NSVisualEffectView
    private let backdrop = CALayer()
    private let shaker = CALayer()
    private let snapLayer = CALayer()
    private let edgeLayer = CALayer()
    private let shadeLayer = CALayer()
    private let redLayer = CALayer()
    private var pulseKey = ""
    private var shakeAmp: Double = 0
    private var active = false
    private var snapshotAt: Date?
    /// Only shake a snapshot that is current; an old one would show a screen that no longer exists.
    private static let snapshotMaxAge: TimeInterval = 3
    private var hasSnapshot: Bool {
        guard let at = snapshotAt, snapLayer.contents != nil else { return false }
        return Date().timeIntervalSince(at) < Self.snapshotMaxAge
    }

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

        blurView = NSVisualEffectView(frame: root.bounds)
        blurView.material = .fullScreenUI
        blurView.blendingMode = .behindWindow
        blurView.state = .active
        blurView.appearance = NSAppearance(named: .aqua)
        blurView.alphaValue = 0
        blurView.autoresizingMask = [.width, .height]
        root.addSubview(blurView)

        // Layer-hosting view: we own these layers, so AppKit never resets them.
        let tint = NSView(frame: root.bounds)
        let host = CALayer()
        tint.layer = host
        tint.wantsLayer = true
        tint.autoresizingMask = [.width, .height]
        root.addSubview(tint)

        backdrop.backgroundColor = NSColor.black.cgColor
        snapLayer.contentsGravity = .resize
        edgeLayer.borderColor = NSColor.black.withAlphaComponent(0.92).cgColor
        shadeLayer.backgroundColor = Palette.shade.cgColor
        redLayer.backgroundColor = Palette.pen.cgColor
        for layer in [backdrop, snapLayer, edgeLayer, shadeLayer, redLayer] { layer.opacity = 0 }
        shaker.addSublayer(snapLayer)
        shaker.addSublayer(edgeLayer)
        [backdrop, shaker, shadeLayer, redLayer].forEach(host.addSublayer)

        place(on: screen)
    }

    func place(on screen: NSScreen) {
        window.setFrame(screen.frame, display: false)
        let bounds = CGRect(origin: .zero, size: screen.frame.size)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        backdrop.frame = bounds
        shaker.frame = bounds
        snapLayer.frame = bounds
        edgeLayer.frame = bounds.insetBy(dx: -Self.bleed, dy: -Self.bleed)
        edgeLayer.borderWidth = Self.bleed + 14
        shadeLayer.frame = bounds
        redLayer.frame = bounds
        CATransaction.commit()
    }

    func setSnapshot(_ image: CGImage?) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        snapLayer.contents = image
        snapshotAt = image == nil ? nil : Date()
        CATransaction.commit()
        updateShakeLayers()
    }

    func apply(_ frame: Frame, reduceTransparency: Bool) {
        let blur = reduceTransparency ? 0 : frame.blur
        // With Reduce Transparency on, the blur would render solid; shade the screen instead.
        let shade = reduceTransparency ? frame.blur * 0.5 : 0
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
        shadeLayer.opacity = Float(shade)
        CATransaction.commit()
        updatePulse(alpha: frame.active ? frame.pulseAlpha : 0, periodMs: frame.pulsePeriodMs)
        updateShake(frame.shaking ? frame.shakeAmp : 0)
        updateShakeLayers() // re-checks snapshot freshness every frame
    }

    private func updatePulse(alpha: Double, periodMs: Double?) {
        let key = "\(alpha)|\(periodMs ?? 0)"
        guard key != pulseKey else { return }
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

    private func updateShake(_ amp: Double) {
        guard amp != shakeAmp else { return }
        shakeAmp = amp
        shaker.removeAnimation(forKey: "vibrate")
        updateShakeLayers()
        guard amp > 0 else { return }
        let x = CAKeyframeAnimation(keyPath: "transform.translation.x")
        x.values = Self.buzz.map { $0.0 * amp }
        let y = CAKeyframeAnimation(keyPath: "transform.translation.y")
        y.values = Self.buzz.map { $0.1 * amp }
        for axis in [x, y] {
            axis.calculationMode = .discrete
            axis.duration = 0.36
        }
        let group = CAAnimationGroup()
        group.animations = [x, y]
        group.duration = 0.36
        group.repeatCount = .infinity
        shaker.add(group, forKey: "vibrate")
    }

    /// Snapshot on a black backdrop when we have one; otherwise just a rattling black frame at the edges.
    private func updateShakeLayers() {
        let shaking = shakeAmp > 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        backdrop.opacity = shaking && hasSnapshot ? 1 : 0
        snapLayer.opacity = shaking && hasSnapshot ? 1 : 0
        edgeLayer.opacity = shaking ? 1 : 0
        CATransaction.commit()
    }

    func close() {
        window.orderOut(nil)
        window.close()
    }
}

// MARK: - Floating timer with the off button

final class HUD {
    static let size = NSSize(width: 690, height: 84)
    /// Where the balance sits; the "-$1" floats up from here.
    private static let balanceFrame = NSRect(x: 420, y: 26, width: 96, height: 44)

    let panel: NSPanel
    private let fader: Fader
    private let body: NSView
    private let time = label("0:00", font: Fonts.pen(38), color: Palette.pen)
    private let caption = label("on your phone", font: Fonts.ui(11, .semibold), color: Palette.pencil)
    private let step = label("", font: Fonts.ui(15, .semibold), color: Palette.ink)
    private let detail = label("", font: Fonts.ui(12), color: Palette.pencil)
    private let balance = label("$5", font: Fonts.pen(32), color: Palette.ink)
    private let balanceCaption = label("deposit left", font: Fonts.ui(11, .semibold), color: Palette.pencil)
    private var lastDeposit: Double?

    init(target: AnyObject, offAction: Selector) {
        panel = floatingPanel(NSPanel.self, size: Self.size)
        fader = Fader(panel)
        body = card(size: Self.size)
        panel.contentView = body

        time.frame = NSRect(x: 22, y: 22, width: 118, height: 50)
        caption.frame = NSRect(x: 24, y: 10, width: 118, height: 16)

        let rule = NSView(frame: NSRect(x: 148, y: 16, width: 1.5, height: 52))
        rule.wantsLayer = true
        rule.layer?.backgroundColor = Palette.pen.withAlphaComponent(0.55).cgColor

        step.frame = NSRect(x: 166, y: 44, width: 228, height: 22)
        detail.frame = NSRect(x: 166, y: 22, width: 228, height: 18)

        let divider = NSView(frame: NSRect(x: 404, y: 16, width: 1, height: 52))
        divider.wantsLayer = true
        divider.layer?.backgroundColor = Palette.ink.withAlphaComponent(0.15).cgColor

        balance.frame = Self.balanceFrame
        balance.alignment = .center
        balanceCaption.frame = NSRect(x: 420, y: 10, width: 96, height: 16)
        balanceCaption.alignment = .center

        let off = inkButton("I'm off my phone", filled: true, target: target, action: offAction)
        off.frame = NSRect(x: 528, y: 20, width: 148, height: 44)

        [time, caption, rule, step, detail, divider, balance, balanceCaption, off].forEach(body.addSubview)
    }

    private static func dollars(_ amount: Double) -> String {
        amount.rounded() == amount ? "$\(Int(amount))" : String(format: "$%.2f", amount)
    }

    /// Balance in ink while intact, red pen once money has gone; a "-$1" floats off on every loss.
    private func updateDeposit(_ frame: Frame) {
        guard let left = frame.depositLeft else { return }
        balance.stringValue = Self.dollars(left)
        balance.textColor = left < (frame.depositTotal ?? left) ? Palette.pen : Palette.ink
        if let last = lastDeposit, left < last { floatMinus(last - left) }
        lastDeposit = left
    }

    private func floatMinus(_ amount: Double) {
        let minus = label("-\(Self.dollars(amount))", font: Fonts.pen(26), color: Palette.pen)
        minus.alignment = .center
        minus.frame = Self.balanceFrame.offsetBy(dx: 0, dy: 10)
        body.addSubview(minus)
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 1.4
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            minus.animator().setFrameOrigin(NSPoint(x: minus.frame.minX, y: minus.frame.minY + 34))
            minus.animator().alphaValue = 0
        }, completionHandler: {
            minus.removeFromSuperview()
        })
    }

    func update(_ frame: Frame) {
        if frame.active {
            time.stringValue = frame.phoneText ?? "0:00"
            step.stringValue = "Step \(frame.levelNumber ?? 1) of \(frame.levelCount ?? 12) · \(frame.levelName ?? "")"
            let extras = [frame.costText, frame.penaltyText].compactMap { $0 }
            detail.stringValue = extras.isEmpty ? "Getting off clears everything." : extras.joined(separator: " · ")
            updateDeposit(frame)
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

        let title = label("Type this to make the popup go away", font: Fonts.ui(15, .semibold), color: Palette.ink)
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
    private let snapper = ScreenSnapper()
    private var lastFrame = Frame.cleared

    override init() {
        super.init()
        hud = HUD(target: self, offAction: #selector(offPressed))
        snitch = SnitchCard()
        confession = ConfessionPanel(target: self, confessAction: #selector(confessPressed), offAction: #selector(offPressed))
        snapper.onImage = { [weak self] id, image in self?.overlays[id]?.setSnapshot(image) }
        syncScreens()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    func apply(_ frame: Frame) {
        lastFrame = frame
        // Keep snapshots fresh for the whole shake step, so each burst starts on a current screen.
        if frame.active && (frame.shakeReady || frame.shaking) {
            snapper.start()
        } else if snapper.running {
            snapper.stop()
            overlays.values.forEach { $0.setSnapshot(nil) }
        }
        let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        overlays.values.forEach { $0.apply(frame, reduceTransparency: reduce) }
        hud.update(frame)
        snitch.update(frame)
        confession.update(frame)
    }

    /// Keep one overlay per display: reuse the ones that still exist, add new displays, drop removed ones.
    private func syncScreens() {
        let screens = NSScreen.screens.compactMap { screen in displayID(of: screen).map { ($0, screen) } }
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
