import Foundation

// Mirrors of GET /api/briefing/bundle — everything the web's Agenda page
// composes. Every field is optional where a panel can fail server-side, so
// one unreachable device (the frame) never takes the page down.

struct AgendaBundle: Codable {
    struct Masthead: Codable { var date_line: String; var unread: Int }
    struct Settings: Codable {
        var timezone: String
        var health_module_enabled: Bool
        var routines_module_enabled: Bool
        var maintenance_module_enabled: Bool
        var agenda_image_url: String?
        var agenda_data_url: String?
    }
    struct PanelEntry: Codable, Identifiable { var id: String; var column: String; var enabled: Bool }
    struct Focus: Codable { var href: String; var title: String; var note: String? }
    struct Counts: Codable { var overdue: Int; var open: Int; var waiting: Int; var routines_done: Int; var routines_total: Int }
    struct Briefing: Codable {
        struct Doing: Codable { var open_count: Int; var overdue_count: Int; var titles: [String] }
        struct Routines: Codable { var total: Int; var done: Int }
        struct Quote: Codable { var id: String; var text: String; var source_author: String?; var source_reference: String?; var source_url: String?; var href: String }
        var inbox_triage_count: Int
        var doing_today: Doing
        var routines_today: Routines
        var latest_quote: Quote?
    }
    struct CadenceRow: Codable, Identifiable {
        struct Stats: Codable {
            struct NextDue: Codable { var date: String; var title: String }
            var projects: Int; var open_tasks: Int; var overdue: Int; var due_soon: Int; var next_due: NextDue?
        }
        var id: String; var name: String; var metric: Int?; var cadence: Int?; var status: String
        var unit: String; var last: String?; var next: String; var stats: Stats?
    }
    struct Agenda: Codable {
        struct AllDay: Codable, Identifiable { var id: String; var title: String }
        struct Task: Codable, Identifiable {
            struct Project: Codable { var id: String; var name: String }
            var id: String; var title: String; var status: String; var domain_id: String?; var project_id: String?
            var workflow_status_id: String?; var due_time: String?; var priority: Int?; var project: Project?
        }
        struct Entry: Codable {
            var kind: String; var id: String?; var title: String?; var time_label: String; var end_label: String?
            var location: String?; var task: Task?
        }
        var date: String; var all_day: [AllDay]; var timeline: [Entry]; var untimed_tasks: [Task]
    }
    struct Pin: Codable, Identifiable {
        struct TaskInfo: Codable { var status: String; var due_date: String?; var priority: Int?; var project: Agenda.Task.Project? }
        struct ProjectInfo: Codable { var kind: String?; var status: String?; var color: String? }
        struct CompanyInfo: Codable { var relationship_type: String?; var silent_days: Int? }
        struct RoutineInfo: Codable { var done_today: Bool; var active: Bool }
        var id: String; var target_type: String; var target_id: String; var position: Int
        var title: String; var subtitle: String?; var href: String; var state: String?
        var task: TaskInfo?; var project: ProjectInfo?; var company: CompanyInfo?; var routine: RoutineInfo?
    }
    struct AttentionItem: Codable, Identifiable {
        var id: String; var rule_type: String; var source_type: String; var source_id: String
        var title: String; var detail: String?; var suggested_action: String?; var urgency: String; var status: String
    }
    struct Attention: Codable { var items: [AttentionItem]; var silent_clients: [AttentionItem]; var active_count: Int }
    struct Routine: Codable, Identifiable {
        struct Stats: Codable { var done_today: Bool; var current_streak: Int?; var longest_streak: Int? }
        var id: String; var name: String; var time_of_day: String?; var specific_time: String?; var position: Int?
        var last_missed_sent_date: String?; var goal_days: Int?; var stats: Stats
    }
    struct Resurfacing: Codable {
        struct Item: Codable { var kind: String; var id: String; var excerpt: String; var source: String?; var href: String? }
        var item: Item?; var exhausted: Bool?; var skipped: Int?
    }
    struct Rail: Codable { var tasks: [OfflineTask]; var overflow: Int; var top3_count: Int }
    struct Health: Codable {
        struct Vital: Codable, Identifiable { var id: String; var metric: String; var value: Double?; var value_secondary: Double?; var unit: String? }
        struct Visit: Codable, Identifiable { var id: String; var visit_date: String; var provider_name: String?; var reason: String? }
        struct LabPanel: Codable, Identifiable {
            struct Result: Codable, Identifiable { var id: String; var analyte: String; var flag: String? }
            var id: String; var panel_name: String; var results: [Result]
        }
        struct Medication: Codable, Identifiable { var id: String; var name: String }
        var latest_vitals: [Vital]; var upcoming_visits: [Visit]; var recent_labs: [LabPanel]; var active_medications: [Medication]
    }
    struct Weather: Codable {
        struct Data: Codable {
            struct Point: Codable { var label: String; var measurement: JSONValue; var unit: String?; var arrow: String? }
            struct Day: Codable { var day: String; var date: String?; var high: Double; var low: Double; var rain_pct: Double? }
            struct Hour: Codable { var time: String; var temperature: Double; var precipitation: Double? }
            var title: String?; var updated_at_text: String?; var current_temperature: JSONValue?; var current_temperature_alt: JSONValue?
            var temperature_unit: String?; var temperature_unit_alt: String?; var forecast: [Day]?; var hourly_forecast: [Hour]?; var data_points: [Point]?
        }
        var data: Data?
    }

    var protocol_version: Int
    var tz: String
    var today: String
    var masthead: Masthead
    var settings: Settings
    var panels: [PanelEntry]
    var focus: Focus?
    var counts: Counts
    var briefing: Briefing?
    var briefing_failed: Bool?
    var domains: [CadenceRow]
    var agenda: Agenda?
    var pins: [Pin]
    var attention: Attention
    var routines: [Routine]
    var routines_failed: Bool?
    var resurfacing: Resurfacing
    var rail: Rail
    var health: Health?
    var weather: Weather?
    var fetchedAt: Date?
}

/// A number-or-string JSON scalar (the frame's bundle mixes both).
enum JSONValue: Codable, Equatable {
    case string(String), number(Double)
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string(try c.decode(String.self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .string(let s): try c.encode(s); case .number(let n): try c.encode(n) }
    }
    var text: String {
        switch self {
        case .string(let s): return s
        case .number(let n): return n.rounded() == n ? String(Int(n)) : String(n)
        }
    }
}
