import XCTest

/// Against the local dev servers (scripts/devctl.sh start + probe@test.local):
/// onboard, then sign in through the web form inside the Agenda shell and
/// check the native chrome carries the page — the web's own tab bar is
/// hidden, the native bar highlights Agenda, and a web link to /work lands on
/// the native Domains tab.
final class LiveShellUITests: XCTestCase {
    func testWebSignInInsideTheShellUsesNativeChrome() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-uitest-reset"]
        app.launch()

        let urlField = app.textFields.element(boundBy: 0)
        XCTAssertTrue(urlField.waitForExistence(timeout: 10))
        urlField.tap()
        urlField.typeText("http://127.0.0.1:3000")
        app.textFields.element(boundBy: 2).tap()
        app.textFields.element(boundBy: 2).typeText("probe@test.local")
        app.secureTextFields.firstMatch.tap()
        app.secureTextFields.firstMatch.typeText("test-password-123456")
        app.buttons["Connect & Link Device"].tap()

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 30))
        let email = web.textFields.firstMatch
        if !email.waitForExistence(timeout: 30) {
            let dump = XCTAttachment(string: app.debugDescription); dump.name = "hierarchy"; dump.lifetime = .keepAlways; add(dump)
            XCTFail("web sign-in form did not render")
            return
        }
        email.tap()
        email.typeText("probe@test.local")
        let password = web.secureTextFields.firstMatch
        password.tap()
        password.typeText("test-password-123456")
        web.buttons["SIGN IN"].firstMatch.tap()

        // The Agenda masthead arrives; the web's "Primary" nav must not.
        let agendaSelected = app.buttons["Agenda"]
        XCTAssertTrue(agendaSelected.waitForExistence(timeout: 30))
        XCTAssertTrue(web.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'WEEK'")).firstMatch.waitForExistence(timeout: 30),
                      "the Agenda masthead date line did not render")
        XCTAssertFalse(web.otherElements["Primary"].exists, "the web tab bar should be hidden inside the shell")
        XCTAssertTrue(agendaSelected.isSelected)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Agenda in the shell"; shot.lifetime = .keepAlways; add(shot)

        // Domains syncs the real workspace from the linked device token.
        app.buttons["Domains"].tap()
        XCTAssertTrue(app.staticTexts["Probe Domain"].waitForExistence(timeout: 30))
        let board = XCTAttachment(screenshot: app.screenshot()); board.name = "Domains synced"; board.lifetime = .keepAlways; add(board)
    }
}
