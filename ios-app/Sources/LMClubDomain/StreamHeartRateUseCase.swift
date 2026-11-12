import Foundation

/// Turns sensor samples into privacy-safe telemetry frames and hands them to the injected publisher.
/// Depends only on ports (DIP), so the same logic serves the watch (HealthKit) and the iPhone (BLE hub).
public actor StreamHeartRateUseCase: HeartRateSink {
    public typealias FrameObserver = @Sendable (TelemetryFrame) -> Void

    private let publisher: TelemetryPublisher
    private let maxHeartRateProvider: MaxHeartRateProviding
    private let minimumInterval: TimeInterval
    private var maxHeartRate: MaxHeartRate = .fallback
    private var sequence = 0
    private var lastPublishedAt: Date?
    private var isActive = false
    private var observer: FrameObserver?

    /// - Parameter minimumInterval: publish cadence. 1s suits MQTT; use 2s over HTTPS on the watch to save battery.
    public init(publisher: TelemetryPublisher, maxHeartRateProvider: MaxHeartRateProviding, minimumInterval: TimeInterval = 1) {
        self.publisher = publisher
        self.maxHeartRateProvider = maxHeartRateProvider
        self.minimumInterval = minimumInterval
    }

    public func setObserver(_ observer: FrameObserver?) { self.observer = observer }

    public func begin(_ session: RealtimeSession) async throws {
        try await publisher.connect(session)
        maxHeartRate = await maxHeartRateProvider.maxHeartRate()
        sequence = 0
        lastPublishedAt = nil
        isActive = true
    }

    public func end() async {
        isActive = false
        await publisher.disconnect()
    }

    public func ingest(_ sample: HeartRateSample) async {
        guard isActive, (30...240).contains(sample.bpm) else { return }
        if let last = lastPublishedAt, sample.capturedAt.timeIntervalSince(last) < minimumInterval { return }
        lastPublishedAt = sample.capturedAt

        let frame = TelemetryFrame(
            bpm: sample.bpm,
            effortPercent: maxHeartRate.effortPercent(forBPM: sample.bpm),
            capturedAt: sample.capturedAt,
            sequence: sequence,
            source: sample.source
        )
        sequence += 1
        observer?(frame) // local UI never waits on the network
        do {
            try await publisher.publish(frame)
        } catch TelemetryError.unauthorized {
            isActive = false // token is dead; stop hammering the broker. The app layer re-joins.
        } catch {
            // Dropped on purpose: a late heart-rate frame is worse than none.
        }
    }

    /// BLE hub entry point: pump a `HeartRateSource` until cancelled.
    public func run(source: HeartRateSource) async throws {
        try await source.start()
        defer { Task { await source.stop() } }
        for await sample in source.samples {
            if Task.isCancelled { break }
            await ingest(sample)
        }
    }
}
