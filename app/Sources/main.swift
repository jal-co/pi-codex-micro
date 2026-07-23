// Codex Micro Bridge — a menu-bar agent that turns the Work Louder
// Codex Micro into a system-wide macropad. It reads the vendor HID
// stream directly and posts keystrokes / runs commands in-process, so
// a single Accessibility grant on this app covers everything (no
// spawned helper binaries with ambiguous TCC identity).
//
// Ownership is focus-based: when the pi host terminal (hostBundleId,
// Zentty by default) is frontmost the pi extension owns the keys and
// this app stays out; any other app frontmost and this app drives the
// bindings from globalKeys (falling back to deviceKeys).

import AppKit
import IOKit.hid
import WebKit

// MARK: - Config

struct Config {
    var hostBundleId = "be.zenjoy.zentty"
    var globalKeys: [String: String] = [:]
    var deviceKeys: [String: String] = [:]
    var alwaysKeys: [String] = ["ACT10"]

    static func load() -> Config {
        var config = Config()
        let path = ("~/.pi/agent/codex-micro.json" as NSString).expandingTildeInPath
        guard let data = FileManager.default.contents(atPath: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return config
        }
        if let host = json["hostBundleId"] as? String { config.hostBundleId = host }
        if let g = json["globalKeys"] as? [String: String] { config.globalKeys = g }
        if let d = json["deviceKeys"] as? [String: String] { config.deviceKeys = d }
        if let a = json["alwaysKeys"] as? [String] { config.alwaysKeys = a }
        return config
    }

    /// Resolve a key id to a binding for out-of-pi use.
    func binding(for key: String) -> String? {
        if let g = globalKeys[key], !g.isEmpty { return g }
        if let d = deviceKeys[key], d.hasPrefix("exec:") || d.hasPrefix("holdexec:") { return d }
        return nil
    }
}

// MARK: - Keystroke posting (in-process, uses this app's Accessibility grant)

enum Keystroke {
    /// Tap virtual keycodes in sequence (e.g. 36 = Return). Flags are
    /// explicitly cleared so a lingering modifier (e.g. fn left over
    /// from dictation) can't turn Return into fn+Return.
    static func tap(_ codes: [CGKeyCode]) {
        for code in codes {
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { continue }
                event.flags = []
                event.post(tap: .cghidEventTap)
                usleep(15_000)
            }
        }
    }

    /// Hold or release the fn (globe) key for dictation apps.
    static func fn(down: Bool) {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 63, keyDown: down) else { return }
        event.type = .flagsChanged
        event.flags = down ? .maskSecondaryFn : []
        event.post(tap: .cghidEventTap)
    }
}

/// Pull trailing integer keycodes out of a legacy `exec:.../keysend 125 36`
/// binding so existing configs keep working without a rewrite.
func keycodesFromKeysend(_ value: String) -> [CGKeyCode]? {
    guard value.contains("keysend") else { return nil }
    let parts = value.split(separator: " ").compactMap { UInt16($0) }
    return parts.isEmpty ? nil : parts.map { CGKeyCode($0) }
}

/// Human-readable keycode names for the menu display.
let keycodeNames: [UInt16: String] = [
    36: "Return", 76: "Enter", 48: "Tab", 49: "Space", 53: "Esc", 51: "Delete",
    123: "Left", 124: "Right", 125: "Down", 126: "Up", 63: "fn",
]

func describeCodes(_ codes: [UInt16]) -> String {
    codes.map { keycodeNames[$0] ?? "key\($0)" }.joined(separator: " + ")
}

/// A short label for what a binding does, for the menu bar.
func describeBinding(_ binding: String) -> String {
    if binding.hasPrefix("key:") {
        return describeCodes(binding.dropFirst(4).split(separator: ",").compactMap { UInt16($0) })
    }
    if binding == "holdfn" { return "fn (hold)" }
    if binding.hasPrefix("run:") { return "run: " + String(binding.dropFirst(4)) }
    if binding.hasPrefix("holdexec:") { return binding.contains("fnkey") ? "fn (hold)" : "hold command" }
    if binding.hasPrefix("exec:") {
        let cmd = String(binding.dropFirst(5))
        if cmd.contains("keysend") {
            return describeCodes(cmd.split(separator: " ").compactMap { UInt16($0) })
        }
        return "run: " + cmd
    }
    return binding
}

func runShell(_ command: String) {
    let task = Process()
    task.launchPath = "/bin/sh"
    task.arguments = ["-c", command]
    try? task.run()
}

// MARK: - Binding execution

func execute(binding: String, act: Int) {
    // Native verbs (preferred): key:36 / key:125,36 / holdfn / run:<cmd>
    if binding.hasPrefix("key:") {
        if act != 1 && act != 2 { return }
        let codes = binding.dropFirst(4).split(separator: ",").compactMap { UInt16($0) }.map { CGKeyCode($0) }
        Keystroke.tap(codes)
        return
    }
    if binding == "holdfn" {
        if act == 1 { Keystroke.fn(down: true) } else if act == 0 { Keystroke.fn(down: false) }
        return
    }
    if binding.hasPrefix("run:") {
        if act == 1 || act == 2 { runShell(String(binding.dropFirst(4))) }
        return
    }
    // Legacy compat: translate keysend/fnkey exec bindings in-process.
    if binding.hasPrefix("holdexec:") {
        if binding.contains("fnkey") {
            if act == 1 { Keystroke.fn(down: true) } else if act == 0 { Keystroke.fn(down: false) }
        }
        return
    }
    if binding.hasPrefix("exec:") {
        if act != 1 && act != 2 { return }
        let cmd = String(binding.dropFirst(5))
        if let codes = keycodesFromKeysend(cmd) {
            Keystroke.tap(codes)
        } else {
            runShell(cmd)
        }
    }
}

// MARK: - HID reader

final class MicroHID {
    private let manager: IOHIDManager
    private var buffer = ""
    private let onKey: (String, Int) -> Void
    // Persistent per-device report buffers (must outlive registration).
    private var reportBuffers: [UnsafeMutablePointer<UInt8>] = []

    init(onKey: @escaping (String, Int) -> Void) {
        self.onKey = onKey
        manager = IOHIDManagerCreate(kCFAllocatorDefault, IOHIDOptionsType(kIOHIDOptionsTypeNone))
        let match: [String: Any] = [kIOHIDVendorIDKey: 0x303A, kIOHIDProductIDKey: 0x8360]
        IOHIDManagerSetDeviceMatching(manager, match as CFDictionary)
    }

    func start() {
        let context = Unmanaged.passUnretained(self).toOpaque()
        // Register each matching device as it appears (handles replug).
        IOHIDManagerRegisterDeviceMatchingCallback(manager, { context, _, _, device in
            guard let context else { return }
            let hid = Unmanaged<MicroHID>.fromOpaque(context).takeUnretainedValue()
            hid.attach(device: device, context: context)
        }, context)
        IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        IOHIDManagerOpen(manager, IOHIDOptionsType(kIOHIDOptionsTypeNone))
        // Also attach devices already connected at launch.
        if let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> {
            for device in devices { attach(device: device, context: context) }
        }
    }

    private func attach(device: IOHIDDevice, context: UnsafeMutableRawPointer) {
        IOHIDDeviceOpen(device, IOHIDOptionsType(kIOHIDOptionsTypeNone))
        let size = 64
        let report = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        report.initialize(repeating: 0, count: size)
        reportBuffers.append(report)
        IOHIDDeviceRegisterInputReportCallback(device, report, size, { context, _, _, _, _, reportPtr, reportLen in
            guard let context else { return }
            let hid = Unmanaged<MicroHID>.fromOpaque(context).takeUnretainedValue()
            let bytes = UnsafeBufferPointer(start: reportPtr, count: reportLen)
            hid.handle(Array(bytes))
        }, context)
        IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
    }

    private func handle(_ report: [UInt8]) {
        // Frame: [reportId? 6][type 2][len][utf8 json...]. The report-id
        // byte is stripped on the input-report callback path, so the
        // first byte is the type.
        guard report.count >= 2 else { return }
        let offset = report[0] == 6 ? 1 : 0
        guard report[offset] == 2 else { return } // channel 1 = debug log
        let len = Int(report[offset + 1])
        guard offset + 2 + len <= report.count else { return }
        let chunk = report[(offset + 2)..<(offset + 2 + len)]
        buffer += String(decoding: chunk, as: UTF8.self)
        if buffer.utf8.count > 8192 { buffer = "" }
        while let nl = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<nl])
            buffer = String(buffer[buffer.index(after: nl)...])
            dispatch(line)
        }
    }

    private func dispatch(_ line: String) {
        guard let data = line.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (json["m"] as? String) == "v.oai.hid",
              let params = json["p"] as? [String: Any],
              let key = params["k"] as? String else { return }
        let act = (params["act"] as? Int) ?? 1
        onKey(key, act)
    }
}

// MARK: - Config window (selection-based)

/// Preset actions offered per key. `value` is the stored binding;
/// empty means unbound, "__custom__" prompts for a shell command.
let actionPresets: [(label: String, value: String)] = [
    ("Unbound", ""),
    ("Return (approve)", "key:36"),
    ("Down + Return (deny)", "key:125,36"),
    ("Escape", "key:53"),
    ("Tab", "key:48"),
    ("Space", "key:49"),
    ("Up", "key:126"),
    ("Down", "key:125"),
    ("Left", "key:123"),
    ("Right", "key:124"),
    ("fn hold (dictation)", "holdfn"),
    ("Custom command…", "__custom__"),
]

/// The keys shown in the configurator (command keys + encoder).
let configurableKeys = [
    "ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT11", "ACT12",
    "ENC_CW", "ENC_CC", "ENC_CLK",
]

/// Map an existing binding string to a preset value (or a run command).
func normalizeToPreset(_ binding: String?) -> String {
    guard let binding, !binding.isEmpty else { return "" }
    if binding.hasPrefix("key:") || binding == "holdfn" { return binding }
    if binding.hasPrefix("run:") { return binding }
    if binding.hasPrefix("holdexec:") { return binding.contains("fnkey") ? "holdfn" : binding }
    if binding.hasPrefix("exec:") {
        let cmd = String(binding.dropFirst(5))
        if cmd.contains("keysend") {
            let codes = cmd.split(separator: " ").compactMap { UInt16($0) }
            return codes.isEmpty ? "run:" + cmd : "key:" + codes.map(String.init).joined(separator: ",")
        }
        return "run:" + cmd
    }
    return binding
}

final class ConfigWindowController: NSObject, WKScriptMessageHandler, NSWindowDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var stateTimer: Timer?
    private let onSaved: () -> Void

    init(onSaved: @escaping () -> Void) { self.onSaved = onSaved }

    func show() {
        if let window {
            injectBindings()
            injectStates()
            startStatePolling()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let controller = WKUserContentController()
        controller.add(self, name: "bridge")
        let cfg = WKWebViewConfiguration()
        cfg.userContentController = controller
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 620), configuration: cfg)
        webView = web

        if let url = Bundle.main.url(forResource: "config", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        let win = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        win.title = "Codex Micro Bridge"
        win.contentView = web
        win.center()
        win.isReleasedWhenClosed = false
        win.delegate = self
        window = win
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startStatePolling()
    }

    /// Push the current effective bindings into the page as preset values.
    private func injectBindings() {
        let config = Config.load()
        var map: [String: String] = [:]
        for key in configurableKeys { map[key] = normalizeToPreset(config.binding(for: key)) }
        guard let data = try? JSONSerialization.data(withJSONObject: map),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.setBindings(\(json))")
    }

    /// Read per-slot agent states written by the pi extension and mirror
    /// them onto the pictured indicator keys.
    private func injectStates() {
        let dir = ("~/.pi/agent/codex-micro-slots" as NSString).expandingTildeInPath
        var states: [String: String] = [:]
        for slot in 0..<6 {
            let path = "\(dir)/\(slot).state"
            if let s = try? String(contentsOfFile: path, encoding: .utf8) {
                states[String(slot)] = s.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: states),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.setStates(\(json))")
    }

    private func startStatePolling() {
        stateTimer?.invalidate()
        stateTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.injectStates()
        }
    }

    func windowWillClose(_ notification: Notification) {
        stateTimer?.invalidate()
        stateTimer = nil
    }

    /// Flash the pressed hardware key on the pictured pad (if open).
    func flashKey(_ key: String) {
        guard let window, window.isVisible else { return }
        webView?.evaluateJavaScript("window.flashKey(\"\(key)\")")
    }

    // JS -> Swift messages: { ready: true } or { key, value }.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["ready"] as? Bool == true { injectBindings(); injectStates(); return }
        guard let key = body["key"] as? String, let value = body["value"] as? String else { return }
        writeBinding(key: key, value: value)
    }

    private func writeBinding(key: String, value: String) {
        let path = ("~/.pi/agent/codex-micro.json" as NSString).expandingTildeInPath
        var json: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: path),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            json = existing
        }
        var global = (json["globalKeys"] as? [String: String]) ?? [:]
        if value.isEmpty { global.removeValue(forKey: key) } else { global[key] = value }
        json["globalKeys"] = global
        if let out = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
            try? out.write(to: URL(fileURLWithPath: path))
        }
        onSaved()
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hid: MicroHID!
    private var config = Config.load()
    private var lastKeyItem: NSMenuItem!
    private var clearTitleWork: DispatchWorkItem?
    private lazy var configWindow = ConfigWindowController { [weak self] in self?.reload() }
    // Where focus was when dictation (mic) started, so a following
    // keystroke (e.g. Enter to send) can be routed back there after
    // Wispr Flow steals focus and doesn't return it.
    private var dictationTarget: NSRunningApplication?
    private var dictationAt = Date.distantPast

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "keyboard.badge.ellipsis", accessibilityDescription: "Codex Micro Bridge")
            button.image?.isTemplate = true
        }
        let menu = NSMenu()
        menu.addItem(withTitle: "Codex Micro Bridge", action: nil, keyEquivalent: "")
        menu.addItem(.separator())
        lastKeyItem = NSMenuItem(title: "Last key: —", action: nil, keyEquivalent: "")
        lastKeyItem.isEnabled = false
        menu.addItem(lastKeyItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Configure…", action: #selector(configure), keyEquivalent: ",")
        menu.addItem(withTitle: "Reload config", action: #selector(reload), keyEquivalent: "r")
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "q")
        statusItem.menu = menu

        hid = MicroHID { [weak self] key, act in
            guard let self else { return }
            // Always-keys (mic) fire regardless of focus so push-to-talk
            // works in every app, including pi. Other keys only fire
            // when pi is not frontmost (the extension owns them there).
            let always = self.config.alwaysKeys.contains(key)
            let front = NSWorkspace.shared.frontmostApplication
            let owned = always || front?.bundleIdentifier != self.config.hostBundleId
            if act == 1 { self.showKey(key, owned: owned); self.configWindow.flashKey(key) }
            if !owned { return }
            guard let binding = self.config.binding(for: key) else { return }

            // Mic press: remember the field being dictated into.
            if act == 1 && (binding == "holdfn" || binding.contains("fnkey")) {
                self.dictationTarget = front
                self.dictationAt = Date()
            }

            // A keystroke soon after dictation: restore the pre-dictation
            // app first, since Wispr may hold focus, then post the keys.
            let isKeystroke = normalizeToPreset(binding).hasPrefix("key:")
            if isKeystroke, act == 1, let target = self.dictationTarget,
               Date().timeIntervalSince(self.dictationAt) < 60,
               front?.processIdentifier != target.processIdentifier {
                target.activate(options: [])
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    execute(binding: binding, act: act)
                }
                return
            }
            execute(binding: binding, act: act)
        }
        hid.start()
    }

    /// Update the menu (and icon tooltip) with the last key and action.
    private func showKey(_ key: String, owned: Bool) {
        let binding = config.binding(for: key)
        let action: String
        if !owned {
            action = "pi owns keys"
        } else if let binding {
            action = describeBinding(binding)
        } else {
            action = "unbound"
        }
        lastKeyItem.title = "\(key) → \(action)"
        statusItem.button?.toolTip = "\(key) → \(action)"

        // Flash the key + action beside the icon so it is visible
        // without opening the menu (which any keypress would dismiss).
        statusItem.button?.title = " \(key)→\(action)"
        clearTitleWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.statusItem.button?.title = "" }
        clearTitleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    @objc private func reload() { config = Config.load() }
    @objc private func configure() { configWindow.show() }
    @objc private func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
