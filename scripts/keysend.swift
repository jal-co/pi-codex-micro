// Tap a sequence of macOS virtual keycodes (e.g. answer TUI dialogs).
// Usage: keysend <keycode> [keycode ...]
//   36 = Return, 125 = Down, 126 = Up, 53 = Escape, 48 = Tab
import CoreGraphics
import Foundation

let codes = CommandLine.arguments.dropFirst().compactMap { UInt16($0) }
guard !codes.isEmpty else {
    FileHandle.standardError.write(Data("usage: keysend <keycode> [keycode ...]\n".utf8))
    exit(64)
}
for code in codes {
    for down in [true, false] {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { exit(1) }
        event.post(tap: .cghidEventTap)
        usleep(30_000)
    }
}
