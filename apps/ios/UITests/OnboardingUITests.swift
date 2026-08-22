import XCTest

/// Drives the real onboarding flow against the local dev servers
/// (scripts/devctl.sh start + the probe@test.local user). Verifies the
/// login → device-token mint → web shell handoff end to end.
final class OnboardingUITests: XCTestCase {
    func testOnboardingLinksDeviceAndOpensShell() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-uitest-reset"]
        app.launch()

        let urlField = app.textFields.element(boundBy: 0)
        XCTAssertTrue(urlField.waitForExistence(timeout: 10), "onboarding URL field missing")
        urlField.tap()
        urlField.typeText("http://127.0.0.1:3000")

        // API URL should auto-derive to :3001 for localhost.
        let apiField = app.textFields.element(boundBy: 1)
        XCTAssertEqual(apiField.value as? String, "http://127.0.0.1:3001", "API URL not derived")

        let emailField = app.textFields.element(boundBy: 2)
        emailField.tap()
        emailField.typeText("probe@test.local")

        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText("test-password-123456")

        app.buttons["Connect & Link Device"].tap()

        // Success lands in the WKWebView shell showing the Next.js sign-in
        // page (separate cookie session, so /sign-in is the expected view).
        XCTAssertTrue(
            app.webViews.firstMatch.waitForExistence(timeout: 30),
            "web shell did not appear after onboarding"
        )
    }
}
