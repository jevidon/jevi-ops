import XCTest

/// Isolated local data and a disconnected model; no owner config, tokens or
/// API are involved. Proves cold-launch navigation and persistence in the app.
final class OfflineUITests: XCTestCase {
    func testDomainsAndTaskEditSurviveOfflineRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["-offline-ui-fixture", "-offline-ui-reset"]
        app.launch()
        let emptyDomain = button(app, "Empty domain")
        XCTAssertTrue(emptyDomain.waitForExistence(timeout: 15))
        attachScreen(app, name: "Domains — shared design")
        emptyDomain.tap()
        XCTAssertTrue(app.staticTexts["No projects or areas here yet."].waitForExistence(timeout: 5))
        app.buttons["All domains"].tap()
        button(app, "Personal").tap()
        attachScreen(app, name: "Projects — shared design")
        button(app, "Empty project").tap()
        XCTAssertTrue(app.staticTexts["No tasks here yet."].waitForExistence(timeout: 5))
        button(app, "← Personal").tap()
        button(app, "Camping kit").tap()
        button(app, "Pack the torch").tap()
        let title = app.textFields["Task title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        attachScreen(app, name: "Task editor — shared design")
        title.tap()
        title.typeText("Check: ")
        app.toolbars.buttons["Done"].tap()
        let editedTitle = title.value as! String
        XCTAssertTrue(editedTitle.contains("Check:"))
        app.buttons["Domains"].tap()
        XCTAssertTrue(button(app, "Keep editing").waitForExistence(timeout: 5))
        button(app, "Keep editing").tap()
        XCTAssertEqual(title.value as? String, editedTitle)
        button(app, "Save on device").tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ==[c] %@", "Pending sync")).firstMatch.waitForExistence(timeout: 5))
        app.terminate()

        app.launchArguments = ["-offline-ui-fixture"]
        app.launch()
        XCTAssertTrue(button(app, "Personal").waitForExistence(timeout: 15))
        button(app, "Personal").tap()
        button(app, "Camping kit").tap()
        XCTAssertTrue(button(app, editedTitle).waitForExistence(timeout: 5))
        XCTAssertEqual(app.tabBars.count, 0, "React owns navigation; no second native tab bar")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Offline tasks with pending edit"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testCaptureRemainsAvailableOffline() {
        let app = XCUIApplication()
        app.launchArguments = ["-offline-ui-fixture", "-offline-ui-reset"]
        app.launch()
        XCTAssertTrue(app.buttons["Capture"].waitForExistence(timeout: 15))
        app.buttons["Capture"].tap()
        let note = app.descendants(matching: .any).matching(identifier: "offlineNote").firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        note.typeText("A note saved without connectivity")
        app.buttons["Save note on phone"].tap()
        XCTAssertTrue(app.staticTexts["Saved on this phone."].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.terminate()
        app.launchArguments = ["-offline-ui-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 15))
        app.buttons["More"].tap()
        button(app, "Saved captures").tap()
        XCTAssertTrue(app.staticTexts["A note saved without connectivity"].waitForExistence(timeout: 5))
    }

    private func attachScreen(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func button(_ app: XCUIApplication, _ prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }
}
