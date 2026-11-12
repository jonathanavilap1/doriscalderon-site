import Foundation
import LMClubDomain

public struct HTTPClassRepository: ClassRepository {
    private let baseURL: URL
    private let transport: HTTPTransport

    public init(baseURL: URL, transport: HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    public func join(pin: String, displayName: String, authentication: AuthenticationToken?) async throws -> JoinReceipt {
        var request = URLRequest(url: baseURL.appending(path: authentication == nil ? "join" : "join/authenticated"), timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let authentication { request.setValue("Bearer \(authentication.bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try Wire.encoder().encode(JoinRequestDTO(pin: pin, displayName: displayName))

        let data: Data
        let http: HTTPURLResponse
        do { (data, http) = try await transport.send(request) } catch { throw JoinError.network }

        switch http.statusCode {
        case 200: break
        case 400: throw JoinError.invalidDisplayName
        case 401, 403: throw JoinError.unauthorized
        case 404: throw JoinError.pinNotFoundOrExpired
        case 410: throw JoinError.classEnded
        case 429: throw JoinError.tooManyAttempts
        default: throw JoinError.network
        }
        do { return try WireCodec.decodeJoinReceipt(data) } catch { throw JoinError.network }
    }
}
