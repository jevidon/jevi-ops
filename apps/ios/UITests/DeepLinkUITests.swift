import XCTest

/// jeviops://new-task must open the native quick-add sheet (same route the
/// "New Task" home-screen quick action uses).
final class DeepLinkUITests: XCTestCase {
    func testNewTaskDeepLinkOpensComposeSheet() throws {
        let app = XCUIApplication()
        app.launch()

        XCUIDevice.shared.system.open(URL(string: "jeviops://new-task")!)

        // First-time scheme opens can show a system confirmation.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let confirm = springboard.alerts.buttons["Open"]
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }

        XCTAssertTrue(
            app.navigationBars["New Task"].waitForExistence(timeout: 10),
            "compose sheet did not open from jeviops://new-task"
        )
    }
}
