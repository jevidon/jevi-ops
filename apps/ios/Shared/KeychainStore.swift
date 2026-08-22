import Foundation
import Security

/// Holds the long-lived `ops_` device token minted by POST /api/auth/tokens.
/// Shared with the extension by using the App Group ID as the keychain
/// access group (iOS allows app-group IDs in kSecAttrAccessGroup, which
/// avoids the $(AppIdentifierPrefix) dance). kSecAttrAccessibleAfterFirstUnlock
/// because the share extension may run while the device was recently locked.
enum KeychainStore {
    private static let service = "com.jevidon.jeviops.device-token"
    private static let account = "ops-token"

    // Simulator builds must ad-hoc sign (never CODE_SIGNING_ALLOWED=NO) so
    // the app-group entitlement is embedded — without it this access group
    // fails with errSecMissingEntitlement and tokens silently vanish.
    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: AppGroup.id,
        ]
    }

    static var deviceToken: String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func setDeviceToken(_ token: String) -> Bool {
        let data = Data(token.utf8)
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let update: [String: Any] = [kSecValueData as String: data]
            return SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary) == errSecSuccess
        }
        return status == errSecSuccess
    }

    static func deleteDeviceToken() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
