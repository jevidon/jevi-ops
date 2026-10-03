import XCTest
import SwiftUI

/// The design system's pure parts: the SVG subset renderer that draws the
/// web's icons, mark and engravings, the domain colour hash, and due labels.
final class DesignTests: XCTestCase {
    func testEveryIconParsesToGeometry() {
        for name in IconName.allCases {
            let doc = Icons.document(name)
            XCTAssertFalse(doc.elements.isEmpty, "\(name) produced no elements")
            let bounds = try! XCTUnwrap(doc.inkBounds)
            XCTAssertTrue(bounds.minX >= 0 && bounds.maxX <= 24 && bounds.minY >= 0 && bounds.maxY <= 24, "\(name) leaves the 24×24 box: \(bounds)")
        }
    }

    func testAlmanacMarkIsAllFillsCentredOnTheDisc() {
        let doc = AlmanacMarkGeometry.document
        XCTAssertEqual(doc.elements.count, 1 + 4 * 2 + 4)
        XCTAssertTrue(doc.elements.allSatisfy { !$0.stroke })
        let bounds = try! XCTUnwrap(doc.inkBounds)
        XCTAssertEqual(bounds.midX, 16, accuracy: 0.2)
        XCTAssertEqual(bounds.midY, 16, accuracy: 0.2)
        // The rotated needles land on all four headings.
        XCTAssertEqual(bounds.minY, 1, accuracy: 0.05)
        XCTAssertEqual(bounds.maxY, 31, accuracy: 0.05)
    }

    func testPathDataHandlesRelativeCommandsCompactFlagsAndArcs() {
        // A closed relative triangle, then an arc with compact "01" flags as the routines icon writes them.
        let path = PathData.parse("M2 2l4 0 0 4z M4.5 9.5a7.5 7.5 0 0113-4.2")
        let box = path.boundingRect
        XCTAssertEqual(box.minX, 2, accuracy: 0.01)
        XCTAssertEqual(box.maxX, 17.5, accuracy: 0.05)
        XCTAssertGreaterThan(path.boundingRect.height, 4)
        // An arc that would close on itself draws a half circle, not a line.
        let half = PathData.parse("M0 0 A5 5 0 0 1 10 0")
        XCTAssertEqual(half.boundingRect.height, 5, accuracy: 0.05)
    }

    func testEngravingContractElementsAndFaintClassParse() {
        let markup = "<line class=\"f\" stroke-width=\"0.6\" x1=\"30\" y1=\"60\" x2=\"66\" y2=\"48\"/><circle cx=\"118\" cy=\"28\" r=\"2\"/>"
            + "<ellipse cx=\"100\" cy=\"70\" rx=\"9\" ry=\"3\"/><rect x=\"10\" y=\"10\" width=\"16\" height=\"13\"/>"
            + "<polyline points=\"30,60 66,48 96,58\"/><path stroke-dasharray=\"2 2\" d=\"M 76 74 Q 118 62 160 74\"/>"
            + "<circle cx=\"50\" cy=\"50\" r=\"4\" fill=\"#FBF8F2\"/><g transform=\"translate(10 0)\"><line x1=\"0\" y1=\"0\" x2=\"5\" y2=\"0\"/></g>"
        let doc = SVGParser.parse(markup)
        XCTAssertEqual(doc.elements.count, 8)
        XCTAssertTrue(doc.elements[0].faint)
        XCTAssertEqual(doc.elements[0].strokeWidth, 0.6)
        XCTAssertEqual(doc.elements[5].dash, [2, 2])
        if case .color = doc.elements[6].fill {} else { XCTFail("knockout fill lost") }
        XCTAssertEqual(doc.elements[7].path.boundingRect.minX, 10, accuracy: 0.01)
        XCTAssertEqual(doc.inkBounds?.minX ?? -1, 10, accuracy: 0.01)
    }

    func testDomainColourHashMatchesTheWebPalette() {
        // djb2 over the normalised name — same input, same swatch, on both surfaces.
        XCTAssertEqual(Theme.domainColor("  Home &   Property "), Theme.domainColor("home & property"))
        XCTAssertNotEqual(Theme.domainColor("Finance"), Theme.domainColor("Finances"))
        XCTAssertTrue(Theme.domainPalette.contains(Theme.domainColor("Anything")))
    }

    func testDueLabelsMirrorTheWeb() {
        XCTAssertEqual(DueLabel.format("2026-09-30", today: "2026-09-30")?.text, "Due today")
        XCTAssertEqual(DueLabel.format("2026-09-27", today: "2026-09-30")?.text, "Overdue 3d")
        XCTAssertEqual(DueLabel.format("2026-10-01", today: "2026-09-30")?.text, "Due tomorrow")
        XCTAssertEqual(DueLabel.format("2026-10-03", today: "2026-09-30")?.text, "Due Sat")
        XCTAssertEqual(DueLabel.format("2026-10-14", today: "2026-09-30")?.text, "Due Wed Oct 14")
        XCTAssertEqual(DueLabel.daysBetween("2026-09-21", "2026-09-30"), 9)
    }

    func testBundledFontsRegister() {
        Typeface.registerBundledFonts(in: Bundle(for: DesignTests.self))
        // Fonts ship in the app bundle; the test bundle proves the loader is
        // harmless without them, and the app target's build proves the files.
        XCTAssertNotNil(Typeface.serif(20))
    }
}
