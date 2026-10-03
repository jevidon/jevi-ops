import Foundation

// Mirrors of the Work payload (packages/shared/src/schemas/work.ts) — the
// computed Domains board the web renders. Every value here is derived by the
// server; the phone renders, never re-computes, so a domain pill can never
// disagree with the web.

struct WorkRollup: Codable {
    var attention = 0, open = 0, overdue = 0, waiting = 0
}

struct WorkProjectCard: Codable, Identifiable {
    struct Ref: Codable { var id: String; var name: String }
    struct Cycle: Codable { var day: Int; var length: Int }
    var id: String
    var kind: String
    var name: String
    var asset: Ref?
    var client: String?
    var target: String?
    var cycle: Cycle?
    var pct: Double?
    var open = 0, overdue = 0, waiting = 0
    var waitOn: String?
    var waitDays: Int?
    var recency = ""
    var flagged = false
    var paused = false
    var urgency: Urgency = .quiet

    var progress: Double? {
        if kind == "target" { return pct }
        if let cycle, cycle.length > 0 { return (Double(cycle.day) / Double(cycle.length) * 100).rounded() }
        return nil
    }

    var metaLine: String {
        var parts: [String] = []
        if kind == "retainer" {
            parts.append(cycle.map { "Retainer · day \($0.day)/\($0.length)" } ?? "Retainer")
        } else {
            parts.append(target.map { "Target \($0.dropFirst(5))" } ?? "No target")
        }
        if let asset { parts.append(asset.name) }
        if paused { parts.append("paused") }
        return parts.joined(separator: " · ")
    }
}

struct WorkContentRow: Codable, Identifiable {
    var id: String
    var title: String
    var type: String
    var status: String
    var holder: String
    var days: Int?
    var move: String?
    var target: String?
    var myMoveDue = false
    var flagged = false
    var urgency: Urgency = .quiet
}

struct WorkDirect: Codable {
    var open = 0, overdue = 0, waiting = 0, waitingAging = 0, today = 0
}

struct WorkAssetCard: Codable, Identifiable {
    struct Maintenance: Codable { var total = 0, overdue = 0, due = 0, due_soon = 0 }
    var id: String
    var name: String
    var kind: String
    var meter_unit: String?
    var latest_reading: Double?
    var latest_reading_days_ago: Int?
    var maintenance = Maintenance()
    var worst: String?
    var data: String = "complete"
    var projects = 0
    var hero: String?
    var flagged = false
    var urgency: Urgency = .quiet

    var dataNote: String? {
        switch data {
        case "needs_baseline": return "needs a baseline reading"
        case "needs_reading": return "no reading yet"
        case "stale_reading": return "reading stale"
        default: return nil
        }
    }

    var meter: String? {
        guard let unit = meter_unit else { return nil }
        if let reading = latest_reading {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            formatter.locale = Locale(identifier: "en_US")
            return "\(formatter.string(from: NSNumber(value: reading)) ?? String(reading)) \(unit)"
        }
        return "no \(unit) reading"
    }
}

struct WorkDomain: Codable, Identifiable {
    var id: String
    var name: String
    var parked = false
    var urgency: Urgency = .quiet
    var rollup = WorkRollup()
    var assets: [WorkAssetCard] = []
    var projects: [WorkProjectCard] = []
    var content: [WorkContentRow] = []
    var direct = WorkDirect()

    var isEmpty: Bool { assets.isEmpty && projects.isEmpty && content.isEmpty && direct.open == 0 && direct.waiting == 0 }
}

struct WorkPayload: Codable {
    var domains: [WorkDomain] = []
    var parked: [WorkDomain] = []
    var ideasCount = 0

    func domain(_ id: String) -> WorkDomain? {
        (domains + parked).first { $0.id == id }
    }
    func project(_ id: String) -> (domain: WorkDomain, project: WorkProjectCard)? {
        for d in domains + parked { if let p = d.projects.first(where: { $0.id == id }) { return (d, p) } }
        return nil
    }
}

let CONTENT_TYPE_LABEL: [String: String] = [
    "video": "Video", "short": "Short", "post": "Post", "article": "Article", "newsletter": "Newsletter",
    "podcast": "Podcast", "thread": "Thread", "essay": "Essay",
]
