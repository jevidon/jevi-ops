import XCTest

/// Drives the native shell against the bundled sample workspace with no
/// server, credentials or network: Domains → domain → task → offline edit,
/// the capture star → a saved note, Search, then a relaunch that finds both.
final class OfflineUITests: XCTestCase {
    func testDomainsCaptureAndSearchSurviveOfflineRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["-offline-ui-fixture", "-offline-ui-reset"]
        app.launch()

        // The native Agenda: masthead, pills and panels from the bundle.
        XCTAssertTrue(app.staticTexts["The Almanac"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["DOMAIN PULSE · 2"].exists)
        attach(app, "Agenda")
        app.swipeUp(); app.swipeUp()
        attach(app, "Agenda panels")

        // Settings is the phone's own; Dark applies to the native chrome.
        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["Dark"].waitForExistence(timeout: 5))
        app.buttons["Dark"].tap()
        XCTAssertTrue(app.buttons["Dark"].isSelected)
        attach(app, "Settings dark")
        app.buttons["System"].tap()
        app.buttons["Done"].tap()

        // Domains board → expand a card → open the domain page.
        app.buttons["Domains"].tap()
        let card = app.otherElements["domainCard-Home & Property"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        attach(app, "Domains board")
        card.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)).tap()
        let open = app.buttons["Open domain: Home & Property"]
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        attach(app, "Domain card expanded")
        open.tap()
        XCTAssertTrue(app.staticTexts["DIRECT TASKS"].waitForExistence(timeout: 5))
        attach(app, "Domain page")

        // Task page → edit offline → pending sync.
        app.buttons["Open task: Water the lemon tree"].tap()
        XCTAssertTrue(app.buttons["EDIT"].waitForExistence(timeout: 5))
        attach(app, "Task page")
        app.buttons["EDIT"].tap()
        let title = app.textFields["offlineTaskTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText(" (deep)")
        let editedTitle = title.value as! String
        XCTAssertTrue(editedTitle.contains("(deep)"))
        app.buttons["offlineTaskSave"].tap()
        XCTAssertTrue(app.staticTexts["PENDING SYNC"].waitForExistence(timeout: 5))
        attach(app, "Task with pending edit")

        // Capture star → note saved on the phone.
        app.buttons["captureStar"].tap()
        let note = app.textFields["offlineNote"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        note.typeText("Offline trail note")
        app.buttons["SAVE"].tap()
        XCTAssertTrue(app.staticTexts["Saved on this phone."].waitForExistence(timeout: 5))
        attach(app, "Capture portal")
        app.buttons["CLOSE"].tap()

        // Search finds the edited task from the local snapshot.
        app.buttons["Search"].tap()
        let search = app.textFields["searchField"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("lemon")
        XCTAssertTrue(app.staticTexts[editedTitle].waitForExistence(timeout: 5))
        attach(app, "Search")

        // Relaunch: the edit and the capture are still there.
        app.terminate()
        app.launchArguments = ["-offline-ui-fixture"]
        app.launch()
        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["Saved captures"].waitForExistence(timeout: 5))
        attach(app, "More sheet")
        app.buttons["Saved captures"].tap()
        XCTAssertTrue(app.staticTexts["Offline trail note"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.buttons["Search"].tap()
        let again = app.textFields["searchField"]
        XCTAssertTrue(again.waitForExistence(timeout: 5))
        again.tap()
        again.typeText("lemon")
        XCTAssertTrue(app.staticTexts[editedTitle].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["PENDING SYNC"].exists)
    }

    /// A workflow project keeps the web's organisation: milestone groups,
    /// subtasks folded under their parent with a done / total chip, custom
    /// statuses in place of checkboxes, and the due-window regrouping.
    func testProjectTasksKeepStatusesFoldsAndGrouping() {
        let app = XCUIApplication()
        app.launchArguments = ["-offline-ui-fixture", "-offline-ui-reset", "-offline-ui-tab", "domains"]
        app.launch()
        let card = app.otherElements["domainCard-Home & Property"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        card.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)).tap()
        app.buttons["Open domain: Home & Property"].tap()
        let project = app.buttons["projectLink-Camping kit"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        project.tap()

        // Milestone grouping leads: Bookings (position 0) then Gear packed.
        XCTAssertTrue(app.otherElements["taskGroup-d1111111-0000-4000-8000-000000000001"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Gear packed"].exists)
        XCTAssertTrue(app.staticTexts["IN PROGRESS · WEIGHT 1"].exists)
        // Parents fold; their children stay out of the flat list until expanded.
        let tech = app.buttons["Open task: Packing: Tech, 1 of 2 subtasks done"]
        XCTAssertTrue(tech.exists)
        XCTAssertFalse(app.staticTexts["Headlamp"].exists)
        // Custom statuses replace the checkbox.
        XCTAssertFalse(app.buttons["Mark task done"].exists)
        XCTAssertTrue(app.buttons["Task status"].firstMatch.exists)
        attach(app, "Project grouped by milestone")
        app.otherElements["parentFold-b2222222-0000-4000-8000-000000000001"].buttons["Expand subtasks"].tap()
        let fold = app.otherElements["parentFold-b2222222-0000-4000-8000-000000000001"]
        XCTAssertTrue(fold.staticTexts["Headlamp"].waitForExistence(timeout: 5))
        XCTAssertFalse(fold.staticTexts["Power bank"].exists, "packed (done) children stay out of the open fold")
        attach(app, "Parent fold expanded")

        app.buttons["groupBy-due"].tap()
        XCTAssertTrue(app.otherElements["taskGroup-undated"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.otherElements["taskGroup-waiting"].exists)
        attach(app, "Project grouped by due window")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
