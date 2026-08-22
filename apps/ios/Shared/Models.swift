import Foundation

// Mirrors of the packages/shared Zod schemas, trimmed to the fields the
// native surfaces use. Response envelopes match the Fastify routes:
// GET /api/domains → {domains:[…]}, GET /api/projects → {projects:[…]},
// POST /api/auth/login → {token, user}, POST /api/auth/tokens → {…, token}.

struct Domain: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var is_system: Bool?
    var active: Bool?

    /// System domains (Inbox) are excluded from pickers — Inbox is its own
    /// capture target (omit domain_id and the server defaults to it).
    var isPickable: Bool { !(is_system ?? false) }
}

struct Project: Codable, Identifiable, Hashable {
    struct DomainRef: Codable, Hashable {
        let id: String
        let name: String
    }

    let id: String
    let name: String
    var status: String?
    var color: String?
    var domain: DomainRef?

    /// Done/archived projects stay out of capture pickers.
    var isPickable: Bool { status == "active" || status == "paused" }
}

/// Request body for POST /api/tasks, per CreateTaskSchema. The server
/// derives domain_id from project_id; sending both mismatched 400s, and
/// omitting both files the task to Inbox — so exactly one (or neither)
/// of project_id/domain_id is ever encoded.
struct CreateTaskPayload: Codable {
    var title: String
    var notes: String?
    var project_id: String?
    var domain_id: String?
    var priority: Int = 4
    var source: String = "manual"
}

struct DomainsResponse: Codable { let domains: [Domain] }
struct ProjectsResponse: Codable { let projects: [Project] }
struct LoginResponse: Codable { let token: String }
struct MintTokenResponse: Codable { let token: String }
