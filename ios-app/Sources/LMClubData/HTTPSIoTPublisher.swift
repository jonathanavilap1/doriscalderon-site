import Foundation
import LMClubDomain

/// Publishes via AWS IoT Core's HTTPS publish endpoint (`POST /topics/{topic}?qos=0`).
///
/// WHY not MQTT on the watch: Apple's TN3135 classes `URLSessionWebSocketTask`/`NWConnection` as low-level
/// networking, which watchOS blocks for workout apps (the simulator allows it, a real watch does not).
/// Plain HTTPS through URLSession is "high-level" networking: permitted, and automatically proxied through the
/// paired iPhone when the watch has no Wi-Fi/cellular, even with the phone locked.
public actor HTTPSIoTPublisher: TelemetryPublisher {
    private let transport: HTTPTransport
    private var session: RealtimeSession?

    public init(transport: HTTPTransport = URLSessionTransport()) { self.transport = transport }

    public func connect(_ session: RealtimeSession) async throws { self.session = session } // stateless

    public func disconnect() async { session = nil }

    public func publish(_ frame: TelemetryFrame) async throws {
        guard let session else { throw TelemetryError.notConnected }
        let request = try Self.makeRequest(session: session, body: WireCodec.encodeTelemetry(frame))
        let status: Int
        do {
            status = try await transport.send(request).1.statusCode
        } catch {
            throw TelemetryError.transient(-1)
        }
        switch status {
        case 200..<300: return
        case 401, 403: throw TelemetryError.unauthorized
        default: throw TelemetryError.transient(status)
        }
    }

    static func makeRequest(session: RealtimeSession, body: Data) throws -> URLRequest {
        // Slashes in the topic are percent-encoded: the topic is ONE path segment of /topics/{topic}.
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        guard let topic = session.publishTopic.addingPercentEncoding(withAllowedCharacters: allowed) else {
            throw TelemetryError.notConnected
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = session.endpoint.host
        components.percentEncodedPath = "/topics/\(topic)"
        components.queryItems = [
            URLQueryItem(name: "qos", value: "0"),
            URLQueryItem(name: "x-amz-customauthorizer-name", value: session.endpoint.authorizerName),
            URLQueryItem(name: "token", value: session.credentials.token),
        ]
        guard let url = components.url else { throw TelemetryError.notConnected }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }
}
