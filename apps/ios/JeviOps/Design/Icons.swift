import SwiftUI

// The thin-stroke icon set — a 1:1 copy of apps/web/src/components/Icon.tsx
// (24×24, stroke 1.5, round caps and joins, currentColor), plus the tab bar's
// "More" glyph. Parsed once and cached; drawn through SVGArt.
enum IconName: String, CaseIterable {
    case today, work, tasks, content, people, companies, library, routines, health, maintenance
    case search, capture, bell, flag, gear, ask, pin, chev, arrow, x, check
    case domains, area, note, quote, journal, mic, agenda, more
}

enum Icons {
    static let markup: [IconName: String] = [
        .today: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
        .work: "<rect x=\"3\" y=\"5\" width=\"13\" height=\"3\" rx=\".5\"/><rect x=\"7\" y=\"10.5\" width=\"14\" height=\"3\" rx=\".5\"/><rect x=\"5\" y=\"16\" width=\"11\" height=\"3\" rx=\".5\"/>",
        .tasks: "<rect x=\"3.5\" y=\"4.5\" width=\"6\" height=\"6\" rx=\".5\"/><path d=\"M5.2 7.4l1.3 1.3 2.3-2.6\"/><rect x=\"3.5\" y=\"13.5\" width=\"6\" height=\"6\" rx=\".5\"/><path d=\"M13 7.5h7.5M13 16.5h7.5\"/>",
        .content: "<rect x=\"3.5\" y=\"4\" width=\"5\" height=\"16\" rx=\".5\"/><rect x=\"9.5\" y=\"4\" width=\"5\" height=\"11\" rx=\".5\"/><rect x=\"15.5\" y=\"4\" width=\"5\" height=\"14\" rx=\".5\"/>",
        .people: "<circle cx=\"12\" cy=\"8\" r=\"3.5\"/><path d=\"M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6\"/>",
        .companies: "<rect x=\"3.5\" y=\"4\" width=\"7.5\" height=\"16\" rx=\".5\"/><rect x=\"13.5\" y=\"9.5\" width=\"7\" height=\"10.5\" rx=\".5\"/><path d=\"M6.2 8h2.2M6.2 12h2.2M16.2 13.5h1.8\"/>",
        .library: "<path d=\"M4 4.5v15l3 .5V5.5z\"/><path d=\"M10 4.5v15l3 .5V5.5z\"/><path d=\"M16.2 5.8l3 14.7 1.5-.4-3-14.7z\"/>",
        .routines: "<path d=\"M4.5 9.5a7.5 7.5 0 0113-4.2M19.5 14.5a7.5 7.5 0 01-13 4.2\"/><path d=\"M4.5 5.5v4h4M19.5 18.5v-4h-4\"/>",
        .health: "<path d=\"M3.5 12.5h4l2-5 3 10 2.5-7 1.5 2h4.5\"/>",
        .maintenance: "<path d=\"M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z\"/>",
        .search: "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M16.2 16.2L21 21\"/>",
        .capture: "<path d=\"M12 5v14M5 12h14\"/>",
        .bell: "<path d=\"M12 4a5.5 5.5 0 00-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0012 4zM10.2 18.5a2 2 0 003.6 0\"/>",
        .flag: "<path d=\"M6 21V4.5M6 4.5h11l-2 3.5 2 3.5H6\"/>",
        .gear: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 14.5l1.7 1-2 3.4-1.9-.7a7.6 7.6 0 01-1.7 1l-.3 2h-4l-.3-2a7.6 7.6 0 01-1.7-1l-1.9.7-2-3.4 1.7-1a7 7 0 010-2l-1.7-1 2-3.4 1.9.7a7.6 7.6 0 011.7-1l.3-2h4l.3 2c.6.25 1.2.58 1.7 1l1.9-.7 2 3.4-1.7 1a7 7 0 010 2z\"/>",
        .ask: "<path d=\"M20.5 12.5c0 3.6-3.8 6.5-8.5 6.5-1 0-2-.13-2.9-.37L4 20.5l1.3-3.4A6.9 6.9 0 013.5 12.5C3.5 8.9 7.3 6 12 6s8.5 2.9 8.5 6.5z\"/>",
        .pin: "<path d=\"M15 3.5l5.5 5.5-2.2 2.2-1-.4-3.6 3.6.5 3.6-1.6 1.6-3.4-3.4L5 21l-.5-.5 4.8-4.2-3.4-3.4L7.5 11l3.6.5 3.6-3.6-.4-1z\"/>",
        .chev: "<path d=\"M9 5l7 7-7 7\"/>",
        .arrow: "<path d=\"M5 12h13M13 6.5l5.5 5.5-5.5 5.5\"/>",
        .x: "<path d=\"M6 6l12 12M18 6L6 18\"/>",
        .check: "<path d=\"M4.5 12.5l4.5 4.5 10-10\"/>",
        .domains: "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\"/><rect x=\"13.5\" y=\"13.5\" width=\"7\" height=\"7\"/>",
        .area: "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\" stroke-dasharray=\"3 3\"/>",
        .note: "<path d=\"M6 3.5h9l3 3v14H6z\"/><path d=\"M15 3.5v3h3M9 11h6M9 14.5h6\"/>",
        .quote: "<path d=\"M5 13.5c0-3.5 2-6 5-7l.7 1.4c-1.9.8-3 2-3.2 3.6H10v5H5zM14 13.5c0-3.5 2-6 5-7l.7 1.4c-1.9.8-3 2-3.2 3.6H19v5h-5z\"/>",
        .journal: "<path d=\"M12 5.5C10 4 7.5 3.5 4 3.7v14.8c3.5-.2 6 .3 8 1.8 2-1.5 4.5-2 8-1.8V3.7c-3.5-.2-6 .3-8 1.8z\"/><path d=\"M12 5.5v14.8\"/>",
        .mic: "<rect x=\"9\" y=\"3.5\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M8.5 21h7\"/>",
        .agenda: "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"1\"/><path d=\"M3.5 9.5h17M8 3v4M16 3v4\"/><circle cx=\"12\" cy=\"14.75\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
        .more: "<circle cx=\"5\" cy=\"12\" r=\"1.4\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\"/><circle cx=\"19\" cy=\"12\" r=\"1.4\"/>",
    ]

    private static var cache: [IconName: SVGDocument] = [:]
    private static let lock = NSLock()

    static func document(_ name: IconName) -> SVGDocument {
        lock.lock(); defer { lock.unlock() }
        if let cached = cache[name] { return cached }
        let parsed = SVGParser.parse(markup[name] ?? "")
        cache[name] = parsed
        return parsed
    }
}

struct Icon: View {
    var name: IconName
    var size: CGFloat = 20
    var strokeWidth: CGFloat = 1.5
    var color: Color = Theme.ink

    var body: some View {
        SVGArt(document: Icons.document(name), viewBox: CGRect(x: 0, y: 0, width: 24, height: 24),
               color: color, faint: color, strokeWidth: strokeWidth)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// The Almanac mark, v2 ("Record Rose W") — the record-button disc wearing a
// compass rose. Pure fills; copied from AlmanacMark.tsx. Pinned linen in both
// themes because it is brand identity, not a theme surface.
enum AlmanacMarkGeometry {
    static let markup: String = {
        let needleSolid = "<polygon points=\"16,1.0 17.9,4.6 16,6.6\"/>"
        let needleHollow = "<path fill-rule=\"evenodd\" d=\"M16,1.0 L14.1,4.6 L16,6.6Z M15.55,2.82 L14.65,4.52 L15.55,5.47Z\"/>"
        let tick = "16,3.4 14.9,6.0 17.1,6.0"
        var s = "<circle cx=\"16\" cy=\"16\" r=\"8.2\" class=\"core\"/>"
        for angle in [0, 90, 180, 270] {
            s += angle == 0 ? "<g>\(needleSolid)\(needleHollow)</g>" : "<g transform=\"rotate(\(angle) 16 16)\">\(needleSolid)\(needleHollow)</g>"
        }
        for angle in [45, 135, 225, 315] {
            s += "<polygon points=\"\(tick)\" transform=\"rotate(\(angle) 16 16)\"/>"
        }
        return s
    }()
    static let document: SVGDocument = {
        var doc = SVGParser.parse(markup)
        for i in doc.elements.indices { doc.elements[i].fill = .current; doc.elements[i].stroke = false }
        return doc
    }()
    /// The record disc alone, so the tab bar can pulse it while listening.
    static let coreDocument = SVGDocument(elements: [doc(document.elements[0])])
    static let roseDocument = SVGDocument(elements: Array(document.elements.dropFirst()))
    private static func doc(_ e: SVGElement) -> SVGElement { e }
}

struct AlmanacMark: View {
    var size: CGFloat = 36
    var color: Color = Theme.linen
    var recording = false
    @State private var pulse = false

    var body: some View {
        let box = CGRect(x: 0, y: 0, width: 32, height: 32)
        ZStack {
            SVGArt(document: AlmanacMarkGeometry.coreDocument, viewBox: box, color: color, faint: color)
                .opacity(recording ? (pulse ? 0.45 : 1) : 1)
                .scaleEffect(recording ? (pulse ? 0.88 : 1) : 1)
                .animation(recording ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulse)
            SVGArt(document: AlmanacMarkGeometry.roseDocument, viewBox: box, color: color, faint: color)
        }
        .frame(width: size, height: size)
        .onAppear { pulse = recording }
        .onChange(of: recording) { _, now in pulse = now }
        .accessibilityHidden(true)
    }
}
