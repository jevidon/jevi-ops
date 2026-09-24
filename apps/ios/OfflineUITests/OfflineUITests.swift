import XCTest

/// Isolated local data and a disconnected model; no owner config, tokens or
/// API are involved. Proves cold-launch navigation and persistence in the app.
final class OfflineUITests: XCTestCase {
    func testCaptureAndTaskEditSurviveOfflineRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["-offline-ui-fixture", "-offline-ui-reset"]
        app.launch()
        let note = app.textFields["offlineNote"]
        XCTAssertTrue(note.waitForExistence(timeout: 10))
        note.tap()
        note.typeText("Offline trail note")
        app.buttons["Save note on phone"].tap()
        XCTAssertTrue(app.staticTexts["Saved on this phone."].waitForExistence(timeout: 5))

        app.tabBars.buttons["Tasks & Lists"].tap()
        app.staticTexts["Pack the torch"].tap()
        XCTAssertTrue(app.staticTexts["Spare batteries are in the drawer"].waitForExistence(timeout: 5))
        app.buttons["Edit"].tap()
        let title = app.textFields["offlineTaskTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Check: ")
        let editedTitle = title.value as! String
        XCTAssertTrue(editedTitle.contains("Check:"))
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Pending sync"].waitForExistence(timeout: 5))
        app.terminate()

        app.launchArguments = ["-offline-ui-fixture"]
        app.launch()
        app.tabBars.buttons["Captures"].tap()
        XCTAssertTrue(app.staticTexts["Offline trail note"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Tasks & Lists"].tap()
        XCTAssertTrue(app.staticTexts[editedTitle].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Pending sync"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Offline tasks with pending edit"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
