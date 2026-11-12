import Foundation

/// Validates input locally (cheap, offline) before spending a request that counts toward brute-force limits.
public struct JoinClassUseCase: Sendable {
    public static let maxDisplayNameLength = 24
    private let repository: ClassRepository

    public init(repository: ClassRepository) { self.repository = repository }

    public func execute(pin: String, displayName: String, authentication: AuthenticationToken? = nil) async throws -> JoinReceipt {
        guard pin.count == 4, pin.allSatisfy({ $0.isASCII && $0.isNumber }) else { throw JoinError.invalidPIN }
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= Self.maxDisplayNameLength else { throw JoinError.invalidDisplayName }
        return try await repository.join(pin: pin, displayName: name, authentication: authentication)
    }
}
