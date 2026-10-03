import SwiftUI

// A small SVG subset renderer, enough for everything the web draws inline:
// the thin-stroke icon set (Icon.tsx), the Almanac mark (AlmanacMark.tsx) and
// the engraved domain illustrations (packages/shared/src/illustration.ts and
// the LLM composer, which share one contract: path/line/circle/ellipse/rect/
// polyline/polygon elements, class="f" faints, stroke-width, dasharray,
// knockout fills, and rotate/translate/scale transforms on <g> or elements).
// Anything outside that subset is ignored rather than failing the drawing.

struct SVGElement {
    enum Fill { case none, current, color(Color) }
    var path: Path
    var faint = false
    var strokeWidth: CGFloat = 1
    var stroke = true
    var fill: Fill = .none
    var evenOdd = false
    var dash: [CGFloat] = []
}

struct SVGDocument {
    var elements: [SVGElement]

    /// Ink bounds — the union of every element's geometry, ignoring stroke
    /// width, matching the web's getBBox()-based fit.
    var inkBounds: CGRect? {
        var box: CGRect?
        for element in elements {
            let b = element.path.boundingRect
            guard !b.isNull, !b.isInfinite else { continue }
            box = box.map { $0.union(b) } ?? b
        }
        return box
    }
}

enum SVGParser {
    static func parse(_ markup: String) -> SVGDocument {
        var elements: [SVGElement] = []
        var transforms: [CGAffineTransform] = [.identity]
        let tagPattern = try! NSRegularExpression(pattern: "<(/?)([a-zA-Z]+)((?:\\s+[^>]*?)?)\\s*(/?)>", options: [])
        let attrPattern = try! NSRegularExpression(pattern: "([a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*\"([^\"]*)\"", options: [])
        let ns = markup as NSString
        for match in tagPattern.matches(in: markup, range: NSRange(location: 0, length: ns.length)) {
            let closing = ns.substring(with: match.range(at: 1)) == "/"
            let name = ns.substring(with: match.range(at: 2)).lowercased()
            let attrText = ns.substring(with: match.range(at: 3))
            let selfClosing = ns.substring(with: match.range(at: 4)) == "/"
            if closing {
                if name == "g", transforms.count > 1 { transforms.removeLast() }
                continue
            }
            var attrs: [String: String] = [:]
            let ans = attrText as NSString
            for a in attrPattern.matches(in: attrText, range: NSRange(location: 0, length: ans.length)) {
                attrs[ans.substring(with: a.range(at: 1)).lowercased()] = ans.substring(with: a.range(at: 2))
            }
            let local = parseTransform(attrs["transform"]).concatenating(transforms.last!)
            if name == "g" {
                if !selfClosing { transforms.append(local) }
                continue
            }
            guard var path = geometry(name, attrs) else { continue }
            path = path.applying(local)
            var element = SVGElement(path: path)
            element.faint = (attrs["class"] ?? "").split(separator: " ").contains("f")
            element.strokeWidth = number(attrs["stroke-width"]) ?? 1
            element.evenOdd = attrs["fill-rule"] == "evenodd"
            if let dash = attrs["stroke-dasharray"] {
                element.dash = dash.split(whereSeparator: { $0 == " " || $0 == "," }).compactMap { Double($0) }.map { CGFloat($0) }
            }
            if let fill = attrs["fill"]?.trimmingCharacters(in: .whitespaces).lowercased() {
                if fill == "none" { element.fill = .none }
                else if fill == "currentcolor" { element.fill = .current }
                else if let color = Color(css: fill) { element.fill = .color(color) }
            }
            if attrs["stroke"]?.lowercased() == "none" { element.stroke = false }
            elements.append(element)
        }
        return SVGDocument(elements: elements)
    }

    private static func number(_ text: String?) -> CGFloat? {
        guard let text, let value = Double(text.trimmingCharacters(in: .whitespaces)) else { return nil }
        return CGFloat(value)
    }

    private static func geometry(_ name: String, _ a: [String: String]) -> Path? {
        switch name {
        case "path":
            guard let d = a["d"] else { return nil }
            return PathData.parse(d)
        case "circle":
            guard let cx = number(a["cx"]), let cy = number(a["cy"]), let r = number(a["r"]) else { return nil }
            return Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
        case "ellipse":
            guard let cx = number(a["cx"]), let cy = number(a["cy"]), let rx = number(a["rx"]), let ry = number(a["ry"]) else { return nil }
            return Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2))
        case "line":
            guard let x1 = number(a["x1"]), let y1 = number(a["y1"]), let x2 = number(a["x2"]), let y2 = number(a["y2"]) else { return nil }
            var p = Path(); p.move(to: CGPoint(x: x1, y: y1)); p.addLine(to: CGPoint(x: x2, y: y2)); return p
        case "rect":
            guard let w = number(a["width"]), let h = number(a["height"]) else { return nil }
            let rect = CGRect(x: number(a["x"]) ?? 0, y: number(a["y"]) ?? 0, width: w, height: h)
            if let rx = number(a["rx"]), rx > 0 { return Path(roundedRect: rect, cornerRadius: rx) }
            return Path(rect)
        case "polyline", "polygon":
            let values = (a["points"] ?? "").split(whereSeparator: { $0 == " " || $0 == "," || $0 == "\n" }).compactMap { Double($0) }
            guard values.count >= 4 else { return nil }
            var p = Path()
            for i in stride(from: 0, to: values.count - 1, by: 2) {
                let point = CGPoint(x: values[i], y: values[i + 1])
                if i == 0 { p.move(to: point) } else { p.addLine(to: point) }
            }
            if name == "polygon" { p.closeSubpath() }
            return p
        default:
            return nil
        }
    }

    /// rotate(a [cx cy]) · translate(x [y]) · scale(s [t]) — applied in the
    /// order SVG lists them (left to right, each nested inside the previous).
    static func parseTransform(_ text: String?) -> CGAffineTransform {
        guard let text else { return .identity }
        var result = CGAffineTransform.identity
        let pattern = try! NSRegularExpression(pattern: "([a-zA-Z]+)\\s*\\(([^)]*)\\)", options: [])
        let ns = text as NSString
        for m in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let fn = ns.substring(with: m.range(at: 1)).lowercased()
            let args = ns.substring(with: m.range(at: 2)).split(whereSeparator: { $0 == " " || $0 == "," }).compactMap { Double($0) }.map { CGFloat($0) }
            var t = CGAffineTransform.identity
            switch fn {
            case "rotate":
                guard let angle = args.first else { continue }
                let radians = angle * .pi / 180
                if args.count >= 3 {
                    t = CGAffineTransform(translationX: args[1], y: args[2]).rotated(by: radians).translatedBy(x: -args[1], y: -args[2])
                } else {
                    t = CGAffineTransform(rotationAngle: radians)
                }
            case "translate":
                guard let x = args.first else { continue }
                t = CGAffineTransform(translationX: x, y: args.count > 1 ? args[1] : 0)
            case "scale":
                guard let x = args.first else { continue }
                t = CGAffineTransform(scaleX: x, y: args.count > 1 ? args[1] : x)
            default:
                continue
            }
            result = t.concatenating(result)
        }
        return result
    }
}

/// SVG path-data parser: M L H V C S Q T A Z, absolute and relative, with
/// implicit command repetition and compact arc flags.
enum PathData {
    static func parse(_ d: String) -> Path {
        var scanner = Scanner(text: d)
        var path = Path()
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var lastCommand: Character = " "
        var command: Character = " "
        while let token = scanner.peek() {
            if token.isLetter {
                command = token
                scanner.advance()
            } else if command == " " {
                break
            } else if command == "M" { command = "L" } else if command == "m" { command = "l" }
            let relative = command.isLowercase
            let base = relative ? current : .zero
            switch command.uppercased().first! {
            case "M":
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = CGPoint(x: base.x + x, y: base.y + y)
                start = current
                path.move(to: current)
                lastControl = nil
            case "L":
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addLine(to: current)
                lastControl = nil
            case "H":
                guard let x = scanner.number() else { return path }
                current = CGPoint(x: base.x + x, y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                guard let y = scanner.number() else { return path }
                current = CGPoint(x: current.x, y: base.y + y)
                path.addLine(to: current)
                lastControl = nil
            case "C":
                guard let x1 = scanner.number(), let y1 = scanner.number(), let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let c1 = CGPoint(x: base.x + x1, y: base.y + y1), c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: current, control1: c1, control2: c2)
                lastControl = c2
            case "S":
                guard let x2 = scanner.number(), let y2 = scanner.number(), let x = scanner.number(), let y = scanner.number() else { return path }
                let reflected = "CS".contains(lastCommand.uppercased()) && lastControl != nil
                    ? CGPoint(x: 2 * current.x - lastControl!.x, y: 2 * current.y - lastControl!.y) : current
                let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: current, control1: reflected, control2: c2)
                lastControl = c2
            case "Q":
                guard let x1 = scanner.number(), let y1 = scanner.number(), let x = scanner.number(), let y = scanner.number() else { return path }
                let c = CGPoint(x: base.x + x1, y: base.y + y1)
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addQuadCurve(to: current, control: c)
                lastControl = c
            case "T":
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let c = "QT".contains(lastCommand.uppercased()) && lastControl != nil
                    ? CGPoint(x: 2 * current.x - lastControl!.x, y: 2 * current.y - lastControl!.y) : current
                current = CGPoint(x: base.x + x, y: base.y + y)
                path.addQuadCurve(to: current, control: c)
                lastControl = c
            case "A":
                guard let rx = scanner.number(), let ry = scanner.number(), let rotation = scanner.number(),
                      let large = scanner.flag(), let sweep = scanner.flag(), let x = scanner.number(), let y = scanner.number() else { return path }
                let end = CGPoint(x: base.x + x, y: base.y + y)
                addArc(to: &path, from: current, to: end, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep)
                current = end
                lastControl = nil
            case "Z":
                path.closeSubpath()
                current = start
                lastControl = nil
            default:
                return path
            }
            lastCommand = command
        }
        return path
    }

    /// Endpoint → centre parameterisation (SVG spec F.6.5), then cubic Bézier
    /// segments of at most 90° each.
    private static func addArc(to path: inout Path, from p1: CGPoint, to p2: CGPoint, rx rxIn: CGFloat, ry ryIn: CGFloat,
                               rotation: CGFloat, large: Bool, sweep: Bool) {
        if p1 == p2 { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 { path.addLine(to: p2); return }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p1.x - p2.x) / 2, dy = (p1.y - p2.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p)
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var coef = den == 0 ? 0 : sqrt(num / den)
        if large == sweep { coef = -coef }
        let cxp = coef * (rx * y1p / ry)
        let cyp = coef * -(ry * x1p / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p1.x + p2.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p1.y + p2.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let dot = ux * vx + uy * vy
            let len = sqrt(ux * ux + uy * uy) * sqrt(vx * vx + vy * vy)
            var a = acos(max(-1, min(1, dot / len)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi } else if sweep && delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        var t1 = theta1
        for _ in 0..<segments {
            let t2 = t1 + step
            let alpha = sin(step) * (sqrt(4 + 3 * tan(step / 2) * tan(step / 2)) - 1) / 3
            func point(_ t: CGFloat) -> CGPoint {
                CGPoint(x: cx + rx * cos(t) * cosPhi - ry * sin(t) * sinPhi, y: cy + rx * cos(t) * sinPhi + ry * sin(t) * cosPhi)
            }
            func derivative(_ t: CGFloat) -> CGPoint {
                CGPoint(x: -rx * sin(t) * cosPhi - ry * cos(t) * sinPhi, y: -rx * sin(t) * sinPhi + ry * cos(t) * cosPhi)
            }
            let s = point(t1), e = point(t2), d1 = derivative(t1), d2 = derivative(t2)
            path.addCurve(to: e, control1: CGPoint(x: s.x + alpha * d1.x, y: s.y + alpha * d1.y),
                          control2: CGPoint(x: e.x - alpha * d2.x, y: e.y - alpha * d2.y))
            t1 = t2
        }
    }

    struct Scanner {
        private let chars: [Character]
        private var index = 0
        init(text: String) { chars = Array(text) }

        private mutating func skipSeparators() {
            while index < chars.count, chars[index] == " " || chars[index] == "," || chars[index] == "\n" || chars[index] == "\t" || chars[index] == "\r" {
                index += 1
            }
        }

        mutating func peek() -> Character? {
            skipSeparators()
            return index < chars.count ? chars[index] : nil
        }

        mutating func advance() { index += 1 }

        mutating func number() -> CGFloat? {
            skipSeparators()
            var text = ""
            var sawDigit = false, sawDot = false, sawExp = false
            while index < chars.count {
                let c = chars[index]
                if c.isNumber { text.append(c); sawDigit = true }
                else if c == ".", !sawDot, !sawExp { text.append(c); sawDot = true }
                else if (c == "-" || c == "+"), text.isEmpty || text.last == "e" || text.last == "E" { text.append(c) }
                else if (c == "e" || c == "E"), sawDigit, !sawExp { text.append(c); sawExp = true }
                else { break }
                index += 1
            }
            guard sawDigit, let value = Double(text) else { return nil }
            return CGFloat(value)
        }

        mutating func flag() -> Bool? {
            skipSeparators()
            guard index < chars.count else { return nil }
            let c = chars[index]
            guard c == "0" || c == "1" else { return nil }
            index += 1
            return c == "1"
        }
    }
}

/// Draws a parsed document inside its viewBox, scaled to fit ("meet") with an
/// SVG-style alignment such as "xMidYMid" or "xMaxYMid".
struct SVGArt: View {
    var document: SVGDocument
    var viewBox: CGRect
    var color: Color
    var faint: Color?
    var strokeWidth: CGFloat?
    var lineCap: CGLineCap = .round
    var align: String = "xMidYMid"

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / viewBox.width, size.height / viewBox.height)
            let drawn = CGSize(width: viewBox.width * scale, height: viewBox.height * scale)
            let ax: CGFloat = align.contains("xMin") ? 0 : align.contains("xMax") ? 1 : 0.5
            let ay: CGFloat = align.contains("YMin") ? 0 : align.contains("YMax") ? 1 : 0.5
            let offset = CGPoint(x: (size.width - drawn.width) * ax, y: (size.height - drawn.height) * ay)
            context.translateBy(x: offset.x - viewBox.minX * scale, y: offset.y - viewBox.minY * scale)
            context.scaleBy(x: scale, y: scale)
            for element in document.elements {
                let ink = element.faint ? (faint ?? color.opacity(0.48)) : color
                switch element.fill {
                case .none: break
                case .current:
                    context.fill(element.path, with: .color(ink), style: FillStyle(eoFill: element.evenOdd))
                case .color(let fillColor):
                    context.fill(element.path, with: .color(fillColor), style: FillStyle(eoFill: element.evenOdd))
                }
                if element.stroke {
                    let width = strokeWidth ?? element.strokeWidth
                    context.stroke(element.path, with: .color(ink),
                                   style: StrokeStyle(lineWidth: width, lineCap: lineCap, lineJoin: .round, dash: element.dash))
                }
            }
        }
    }
}
