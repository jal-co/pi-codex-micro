// Synthesize fn (globe) key events for hold-to-talk dictation apps.
// Usage: fnkey down | up | tap
import CoreGraphics
import Foundation

func post(_ down: Bool) {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 63, keyDown: down) else { exit(1) }
    event.type = .flagsChanged
    event.flags = down ? .maskSecondaryFn : []
    event.post(tap: .cghidEventTap)
}

switch CommandLine.arguments.dropFirst().first {
case "down": post(true)
case "up": post(false)
case "tap":
    post(true)
    usleep(50_000)
    post(false)
default:
    FileHandle.standardError.write(Data("usage: fnkey down|up|tap\n".utf8))
    exit(64)
}
