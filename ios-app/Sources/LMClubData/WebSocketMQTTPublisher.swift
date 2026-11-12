import Foundation
import LMClubDomain

/// Persistent MQTT 3.1.1 connection over WebSockets to AWS IoT Core (iPhone / iPad only; see HTTPSIoTPublisher
/// for why the watch cannot use this). QoS 0, publish-only; PINGREQs keep the connection alive.
public actor WebSocketMQTTPublisher: TelemetryPublisher {
    private let urlSession: URLSession
    private let keepAlive: UInt16 = 30
    private var task: URLSessionWebSocketTask?
    private var topic: String?
    private var pingTask: Task<Void, Never>?
    private var connected = false

    public init(urlSession: URLSession = .shared) { self.urlSession = urlSession }

    public func connect(_ session: RealtimeSession) async throws {
        await disconnect()
        var components = URLComponents()
        components.scheme = "wss"
        components.host = session.endpoint.host
        components.path = "/mqtt"
        components.queryItems = [
            URLQueryItem(name: "x-amz-customauthorizer-name", value: session.endpoint.authorizerName),
            URLQueryItem(name: "token", value: session.credentials.token),
        ]
        guard let url = components.url else { throw TelemetryError.handshakeFailed }

        let ws = urlSession.webSocketTask(with: url, protocols: ["mqtt"])
        ws.resume()
        task = ws
        topic = session.publishTopic

        do {
            try await ws.send(.data(MQTT311.connect(clientID: session.clientID, keepAlive: keepAlive)))
            let reply = try await Self.receive(ws, timeout: .seconds(10))
            guard MQTT311.connackReturnCode(reply) == 0 else { throw TelemetryError.handshakeFailed }
        } catch {
            ws.cancel(with: .goingAway, reason: nil)
            task = nil
            throw error is TelemetryError ? error : TelemetryError.handshakeFailed
        }
        connected = true
        startKeepAlive(ws)
    }

    public func publish(_ frame: TelemetryFrame) async throws {
        guard connected, let task, let topic else { throw TelemetryError.notConnected }
        do {
            try await task.send(.data(MQTT311.publish(topic: topic, payload: WireCodec.encodeTelemetry(frame))))
        } catch {
            connected = false // the resilient decorator reconnects
            throw TelemetryError.transient(-1)
        }
    }

    public func disconnect() async {
        pingTask?.cancel()
        if connected, let task { try? await task.send(.data(MQTT311.disconnect)) }
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        connected = false
    }

    private func startKeepAlive(_ ws: URLSessionWebSocketTask) {
        pingTask = Task { [keepAlive] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Int(keepAlive) / 2))
                if Task.isCancelled { return }
                do { try await ws.send(.data(MQTT311.pingRequest)) } catch {
                    self.markDisconnected()
                    return
                }
            }
        }
    }

    private func markDisconnected() { connected = false }

    private static func receive(_ ws: URLSessionWebSocketTask, timeout: Duration) async throws -> Data {
        try await withThrowingTaskGroup(of: Data.self) { group in
            group.addTask {
                switch try await ws.receive() {
                case .data(let d): return d
                case .string(let s): return Data(s.utf8)
                @unknown default: throw TelemetryError.handshakeFailed
                }
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw TelemetryError.handshakeFailed
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }
}
