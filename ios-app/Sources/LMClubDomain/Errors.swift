import Foundation

public enum JoinError: Error, Equatable, Sendable {
    case invalidPIN
    case invalidDisplayName
    case pinNotFoundOrExpired
    case tooManyAttempts
    case classEnded
    case unauthorized
    case network
}

public enum TelemetryError: Error, Equatable, Sendable {
    case notConnected
    case unauthorized      // token expired / revoked: re-join instead of retrying
    case transient(Int)    // HTTP status or socket failure: safe to drop the frame and carry on
    case handshakeFailed
}
