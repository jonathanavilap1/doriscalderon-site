import Foundation

/// Shared monorepo fixtures: Swift is tested against the very same JSON the backend and TV validate.
enum Contracts {
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "contracts")

    static func data(_ relative: String) throws -> Data { try Data(contentsOf: root.appending(path: relative)) }
    static func json(_ relative: String) throws -> Any { try JSONSerialization.jsonObject(with: data(relative)) }
}
