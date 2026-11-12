import Foundation
import Observation
import LMClubDomain

/// Local, network-independent mirror of what the TV shows for this athlete.
@MainActor
@Observable
public final class LiveEffortViewModel {
    public private(set) var bpm: Int?
    public private(set) var effortPercent: Double = 0
    public private(set) var zone: EffortZone = .gray

    public init() {}

    public func apply(_ frame: TelemetryFrame) {
        bpm = frame.bpm
        effortPercent = frame.effortPercent
        zone = frame.zone
    }

    /// Bridges the use case's `@Sendable` observer onto the main actor.
    public nonisolated func observer() -> StreamHeartRateUseCase.FrameObserver {
        { [weak self] frame in Task { @MainActor in self?.apply(frame) } }
    }
}
