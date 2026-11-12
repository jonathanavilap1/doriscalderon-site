import Foundation

/// Outbound port for telemetry. Implementations: HTTPS (watchOS), MQTT over WebSocket (iPhone), fakes in tests.
public protocol TelemetryPublisher: Sendable {
    func connect(_ session: RealtimeSession) async throws
    /// Best effort (QoS 0): a failure means the frame is dropped, never queued; stale live data has no value.
    func publish(_ frame: TelemetryFrame) async throws
    func disconnect() async
}

public protocol ClassRepository: Sendable {
    func join(pin: String, displayName: String, authentication: AuthenticationToken?) async throws -> JoinReceipt
}

/// Inbound port: the watch's WorkoutManager and the BLE hub both push samples here (ISP: they only know this).
public protocol HeartRateSink: Sendable {
    func ingest(_ sample: HeartRateSample) async
}

public protocol HeartRateSource: Sendable {
    var samples: AsyncStream<HeartRateSample> { get }
    func start() async throws
    func stop() async
}

public protocol MaxHeartRateProviding: Sendable {
    func maxHeartRate() async -> MaxHeartRate
}
