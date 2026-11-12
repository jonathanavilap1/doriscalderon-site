import Foundation
import LMClubDomain

/// Decorator (OCP): adds exponential-backoff reconnection to any stateful publisher without touching it.
public actor ResilientTelemetryPublisher: TelemetryPublisher {
    private let inner: TelemetryPublisher
    private let backoff: [Duration]
    private var session: RealtimeSession?
    private var reconnecting: Task<Void, Never>?
    private let now: @Sendable () -> Date

    public init(wrapping inner: TelemetryPublisher,
                backoff: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(15), .seconds(30)],
                now: @escaping @Sendable () -> Date = Date.init) {
        self.inner = inner
        self.backoff = backoff
        self.now = now
    }

    public func connect(_ session: RealtimeSession) async throws {
        self.session = session
        try await inner.connect(session)
    }

    public func publish(_ frame: TelemetryFrame) async throws {
        do {
            try await inner.publish(frame)
        } catch TelemetryError.unauthorized {
            throw TelemetryError.unauthorized
        } catch {
            scheduleReconnect()
            throw error
        }
    }

    public func disconnect() async {
        reconnecting?.cancel()
        reconnecting = nil
        session = nil
        await inner.disconnect()
    }

    private func scheduleReconnect() {
        guard reconnecting == nil, let session else { return }
        reconnecting = Task {
            var attempt = 0
            while !Task.isCancelled, now() < session.credentials.expiresAt {
                try? await Task.sleep(for: backoff[min(attempt, backoff.count - 1)])
                if Task.isCancelled { break }
                if (try? await inner.connect(session)) != nil { break }
                attempt += 1
            }
            reconnecting = nil
        }
    }
}
