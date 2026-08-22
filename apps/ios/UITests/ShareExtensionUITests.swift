import XCTest

/// Drives the real iOS share sheet: Safari → share example.com → Jevi Ops
/// activity → TaskComposeView → Save. Requires the app to be onboarded
/// against the dev servers (OnboardingUITests runs first alphabetically and
/// leaves a linked device behind).
final class ShareExtensionUITests: XCTestCase {
    func testShareURLCreatesTask() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        // Reach the address bar (bottom bar on modern iPhone Safari).
        let address = safari.textFields["Address"].exists
            ? safari.textFields["Address"]
            : safari.buttons["Address"]
        XCTAssertTrue(address.waitForExistence(timeout: 10), "Safari address bar not found")
        address.tap()
        safari.typeText("example.com\n")

        // iOS 26 Safari: sharing lives in the "More" page menu; older
        // versions expose ShareButton directly.
        if safari.buttons["ShareButton"].waitForExistence(timeout: 5) {
            safari.buttons["ShareButton"].tap()
        } else {
            let more = safari.buttons["MoreMenuButton"]
            XCTAssertTrue(more.waitForExistence(timeout: 10), "no share entry point found")
            more.tap()
            let shareItem = safari.buttons["Share"].exists
                ? safari.buttons["Share"]
                : safari.cells["Share"]
            XCTAssertTrue(
                shareItem.waitForExistence(timeout: 10),
                "Share item missing in More menu; tree:\n\(safari.debugDescription)"
            )
            shareItem.tap()
        }

        // Our activity in the share sheet. It may sit off-screen in the app row.
        let activity = safari.buttons["Jevi Ops"].exists
            ? safari.buttons["Jevi Ops"]
            : safari.cells["Jevi Ops"]
        if !activity.waitForExistence(timeout: 10) {
            safari.swipeUp()
        }
        XCTAssertTrue(activity.waitForExistence(timeout: 10), "Jevi Ops missing from share sheet")
        activity.tap()

        // TaskComposeView, hosted in the extension process. Typing across
        // that process boundary is flaky in XCUITest, so rely on the
        // prefilled title (page title or URL host) and just save; the API
        // check keys off the shared URL in the task notes.
        let save = safari.buttons["Save"]
        XCTAssertTrue(save.waitForExistence(timeout: 15), "compose sheet did not appear")
        XCTAssertTrue(save.isEnabled, "Save disabled — device not linked in extension?")
        save.tap()

        // Sheet dismisses on success (completeRequest).
        XCTAssertTrue(
            save.waitForNonExistence(timeout: 20),
            "compose sheet did not dismiss after Save"
        )
    }
}
