// Render a 1024x1024 app icon PNG for Codex Micro Bridge: a rounded
// dark tile with the brand blue and a white keyboard glyph. Output is
// written to the path given as the first argument.
import AppKit

let size = 1024.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

// Rounded background with a top-down gradient (near-black -> blue).
let rect = NSRect(x: 0, y: 0, width: size, height: size)
let path = NSBezierPath(roundedRect: rect, xRadius: size * 0.22, yRadius: size * 0.22)
path.addClip()
let gradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.06, green: 0.07, blue: 0.10, alpha: 1),
    NSColor(calibratedRed: 0.24, green: 0.49, blue: 1.0, alpha: 1),
])
gradient?.draw(in: rect, angle: -90)

// Centered keyboard glyph.
let config = NSImage.SymbolConfiguration(pointSize: size * 0.5, weight: .semibold)
if let symbol = NSImage(systemSymbolName: "keyboard.fill", accessibilityDescription: nil)?
    .withSymbolConfiguration(config) {
    let tinted = NSImage(size: symbol.size)
    tinted.lockFocus()
    NSColor.white.set()
    let r = NSRect(origin: .zero, size: symbol.size)
    symbol.draw(in: r)
    r.fill(using: .sourceAtop)
    tinted.unlockFocus()
    let w = symbol.size.width, h = symbol.size.height
    tinted.draw(in: NSRect(x: (size - w) / 2, y: (size - h) / 2, width: w, height: h))
}

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
try? png.write(to: URL(fileURLWithPath: out))
