import Foundation
import LMClubDomain

/// Serialises a `RealtimeSession` for iPhone -> Watch transfer (WatchConnectivity). Private to our two apps,
/// so it is intentionally NOT part of the shared server contracts.
public enum HandoffCodec {
    private struct Payload: Codable {
        let host: String
        let authorizer: String
        let clientId: String
        let token: String
        let expiresAt: Date
        let topic: String
    }

    public static func encode(_ s: RealtimeSession) throws -> Data {
        try JSONEncoder().encode(Payload(host: s.endpoint.host, authorizer: s.endpoint.authorizerName, clientId: s.clientID,
                                         token: s.credentials.token, expiresAt: s.credentials.expiresAt, topic: s.publishTopic))
    }

    public static func decode(_ data: Data) throws -> RealtimeSession {
        let p = try JSONDecoder().decode(Payload.self, from: data)
        return RealtimeSession(endpoint: .init(host: p.host, authorizerName: p.authorizer), clientID: p.clientId,
                               credentials: .init(token: p.token, expiresAt: p.expiresAt), publishTopic: p.topic)
    }
}
