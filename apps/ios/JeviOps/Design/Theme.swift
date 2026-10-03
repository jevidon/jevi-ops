import SwiftUI
import UIKit
import CoreText

// The Almanac design tokens, mirrored from apps/web/src/styles/globals.css and
// tailwind.config.ts. Light is the re-warmed linen; dark is "Umber" — the linen
// inverted. Every colour is a dynamic UIColor so the app follows the system
// appearance exactly as the web's `prefers-color-scheme` block does.
enum Theme {
    private static func rgb(_ r: Int, _ g: Int, _ b: Int, _ a: Double = 1) -> UIColor {
        UIColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: a)
    }
    private static func dynamic(_ light: UIColor, _ dark: UIColor) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    // Surfaces — linen canvas, paper raised, recessed darker.
    static let bg = dynamic(rgb(246, 242, 234), rgb(25, 21, 18))
    static let surface = dynamic(rgb(252, 250, 245), rgb(33, 28, 23))
    static let surface2 = dynamic(rgb(239, 233, 221), rgb(18, 15, 12))
    static let surface3 = dynamic(rgb(230, 223, 208), rgb(13, 11, 9))
    // Ink ramp. ink3 is the floor for text; ink4 is non-text only.
    static let ink = dynamic(rgb(18, 16, 14), rgb(240, 234, 223))
    static let ink2 = dynamic(rgb(87, 82, 74), rgb(198, 190, 175))
    static let ink3 = dynamic(rgb(139, 132, 122), rgb(151, 144, 127))
    static let ink4 = dynamic(rgb(182, 175, 164), rgb(102, 95, 82))
    // Hairlines — ink at the design alpha.
    static let line = dynamic(rgb(18, 16, 14, 0.09), rgb(240, 234, 223, 0.10))
    static let lineStrong = dynamic(rgb(18, 16, 14, 0.17), rgb(240, 234, 223, 0.19))
    static let lineStrongest = dynamic(rgb(18, 16, 14, 0.34), rgb(240, 234, 223, 0.36))
    static let inkWash = dynamic(rgb(18, 16, 14, 0.045), rgb(240, 234, 223, 0.06))
    // Accent — rust; dark lifts it one step toward ember.
    static let accent = dynamic(rgb(184, 68, 43), rgb(214, 106, 79))
    static let accentInk = dynamic(rgb(138, 51, 32), rgb(224, 138, 110))
    static let accentSlip = dynamic(rgb(156, 63, 38), rgb(222, 124, 94))
    static let accentBg = dynamic(rgb(184, 68, 43, 0.08), rgb(214, 106, 79, 0.12))
    static let accentSoft = dynamic(rgb(184, 68, 43, 0.09), rgb(214, 106, 79, 0.13))
    static let accentLine = dynamic(rgb(184, 68, 43, 0.30), rgb(214, 106, 79, 0.40))
    static let accentHalf = dynamic(rgb(184, 68, 43, 0.55), rgb(214, 106, 79, 0.55))
    // Status — used only inside pills.
    static let warn = dynamic(rgb(150, 101, 15), rgb(201, 155, 74))
    static let warnSoft = dynamic(rgb(150, 101, 15, 0.10), rgb(201, 155, 74, 0.13))
    static let warnLine = dynamic(rgb(150, 101, 15, 0.28), rgb(201, 155, 74, 0.36))
    static let good = dynamic(rgb(59, 106, 82), rgb(124, 173, 144))
    static let goodSoft = dynamic(rgb(59, 106, 82, 0.10), rgb(124, 173, 144, 0.13))
    static let goodLine = dynamic(rgb(59, 106, 82, 0.26), rgb(124, 173, 144, 0.34))
    static let prio3 = dynamic(rgb(63, 95, 134), rgb(133, 163, 198))
    // Brand identity, not a theme surface: the mark and its ring stay linen
    // on rust in both themes.
    static let linen = Color(red: 246 / 255, green: 242 / 255, blue: 234 / 255)
    static let dim = dynamic(rgb(18, 16, 14, 0.40), rgb(0, 0, 0, 0.55))

    /// The v2 handoff palette for domain identity colours — hashed from the
    /// normalised name exactly as apps/web/src/lib/domain-colors.ts does, so
    /// a domain wears the same colour on the phone and on the web.
    static let domainPalette: [Color] = [
        Color(hex: 0x2F5D8A), Color(hex: 0x6B5B95), Color(hex: 0x3B6A52), Color(hex: 0xA8763E),
        Color(hex: 0x8A4B3C), Color(hex: 0x4A6B70), Color(hex: 0x8A6A2F), Color(hex: 0x5C5470),
    ]

    static func domainColor(_ name: String) -> Color {
        let key = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        var h: Int32 = 5381
        for unit in key.utf16 {
            h = (h &<< 5) &+ h &+ Int32(unit)
        }
        return domainPalette[Int(h.magnitude) % domainPalette.count]
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    /// Parses "#RRGGBB" (the project colour column); nil for anything else.
    init?(css: String) {
        var text = css.trimmingCharacters(in: .whitespaces)
        guard text.hasPrefix("#") else { return nil }
        text.removeFirst()
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(hex: value)
    }
}

// Typography — Newsreader (serif), Geist (sans), Geist Mono. Fixed sizes mirror
// the web's px values; the web does not scale with Dynamic Type either.
enum Typeface {
    enum Weight { case regular, medium, semibold, bold }

    static func serif(_ size: CGFloat, _ weight: Weight = .medium, italic: Bool = false) -> Font {
        if italic { return .custom("Newsreader-Italic", fixedSize: size) }
        switch weight {
        case .regular: return .custom("Newsreader-Regular", fixedSize: size)
        case .medium: return .custom("Newsreader-Medium", fixedSize: size)
        case .semibold, .bold: return .custom("Newsreader-SemiBold", fixedSize: size)
        }
    }

    static func sans(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        switch weight {
        case .regular: return .custom("Geist-Regular", fixedSize: size)
        case .medium: return .custom("Geist-Medium", fixedSize: size)
        case .semibold: return .custom("Geist-SemiBold", fixedSize: size)
        case .bold: return .custom("Geist-Bold", fixedSize: size)
        }
    }

    static func mono(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        switch weight {
        case .regular: return .custom("GeistMono-Regular", fixedSize: size)
        case .medium: return .custom("GeistMono-Medium", fixedSize: size)
        case .semibold, .bold: return .custom("GeistMono-SemiBold", fixedSize: size)
        }
    }

    /// Registers the bundled TTFs once per process. Runtime registration keeps
    /// the fonts working from the app, the tests and any future extension
    /// without each target repeating a UIAppFonts list.
    static func registerBundledFonts(in bundle: Bundle = .main) {
        registrationLock.lock()
        defer { registrationLock.unlock() }
        guard !registered else { return }
        registered = true
        let urls = bundle.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
        for url in urls {
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error),
               let error = error?.takeRetainedValue(),
               CFErrorGetCode(error) != CTFontManagerError.alreadyRegistered.rawValue {
                print("[jeviops] font registration failed for \(url.lastPathComponent): \(error)")
            }
        }
    }

    private static var registered = false
    private static let registrationLock = NSLock()
}
