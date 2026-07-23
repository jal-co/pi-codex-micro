// Print the bundle identifier of the frontmost application.
// Used to decide who owns the Codex Micro keys: the pi host terminal
// (when focused) or the background daemon (any other app focused).
import AppKit

if let id = NSWorkspace.shared.frontmostApplication?.bundleIdentifier {
    print(id)
}
