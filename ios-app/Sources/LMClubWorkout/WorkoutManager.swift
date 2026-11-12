#if os(watchOS)
import Foundation
import HealthKit
import Observation
import LMClubDomain

/// Owns the `HKWorkoutSession` + `HKLiveWorkoutBuilder` and forwards every heart-rate update to an injected
/// `HeartRateSink` (SOLID: it knows nothing about MQTT, HTTP, AWS or effort zones).
///
/// Background behaviour: a running workout session is what keeps a watchOS app executing with the wrist down
/// (Info.plist `WKBackgroundModes = workout-processing`, HealthKit capability). Network I/O performed by the
/// sink uses URLSession, which watchOS transparently proxies through the paired iPhone, even if it is locked.
@MainActor
@Observable
public final class WorkoutManager: NSObject {
    public enum State: Equatable { case idle, starting, running, ending, failed(String) }

    public private(set) var state: State = .idle
    public private(set) var latestBPM: Int?

    private let healthStore: HKHealthStore
    private let sink: HeartRateSink
    private let heartRateType = HKQuantityType(.heartRate)
    private let bpmUnit = HKUnit.count().unitDivided(by: .minute())
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var saveToHealth = true

    public init(sink: HeartRateSink, healthStore: HKHealthStore = HKHealthStore()) {
        self.sink = sink
        self.healthStore = healthStore
        super.init()
    }

    public func requestAuthorization() async throws {
        try await healthStore.requestAuthorization(
            toShare: [HKObjectType.workoutType()],
            read: [heartRateType, HKCharacteristicType(.dateOfBirth)]
        )
    }

    /// - Parameter saveToHealth: guests may opt out; authenticated athletes get the workout in Apple Health/Fitness.
    public func start(activity: HKWorkoutActivityType, saveToHealth: Bool = true) async throws {
        guard state == .idle || { if case .failed = state { return true } else { return false } }() else { return }
        state = .starting
        self.saveToHealth = saveToHealth

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        configuration.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder

            let start = Date()
            session.startActivity(with: start)
            try await builder.beginCollection(at: start)
        } catch {
            state = .failed(error.localizedDescription)
            throw error
        }
    }

    public func end() {
        guard state == .running || state == .starting else { return }
        state = .ending
        session?.end() // completion continues in workoutSession(_:didChangeTo:from:date:)
    }

    private func finish(at date: Date) async {
        defer { session = nil; builder = nil; state = .idle; latestBPM = nil }
        guard let builder else { return }
        do {
            try await builder.endCollection(at: date)
            if saveToHealth { _ = try await builder.finishWorkout() } else { builder.discardWorkout() }
        } catch {
            builder.discardWorkout()
        }
    }

    fileprivate func handleCollected(types: Set<HKSampleType>) {
        guard types.contains(heartRateType),
              let quantity = builder?.statistics(for: heartRateType)?.mostRecentQuantity() else { return }
        let bpm = Int(quantity.doubleValue(for: bpmUnit).rounded())
        latestBPM = bpm
        let sample = HeartRateSample(bpm: bpm, capturedAt: Date(), source: .appleWatch)
        let sink = self.sink
        Task { await sink.ingest(sample) }
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated public func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                                           from fromState: HKWorkoutSessionState, date: Date) {
        Task { @MainActor in
            switch toState {
            case .running: self.state = .running
            case .ended: await self.finish(at: date)
            default: break
            }
        }
    }

    nonisolated public func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.state = .failed(error.localizedDescription) }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated public func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        Task { @MainActor in self.handleCollected(types: collectedTypes) }
    }

    nonisolated public func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

/// Reads age from HealthKit on-device (never transmitted) and derives max HR with the Tanaka formula.
public struct HealthKitMaxHeartRateProvider: MaxHeartRateProviding {
    public init() {}

    public func maxHeartRate() async -> MaxHeartRate {
        let store = HKHealthStore()
        guard let dob = try? store.dateOfBirthComponents(),
              let birth = Calendar.current.date(from: dob),
              let age = Calendar.current.dateComponents([.year], from: birth, to: Date()).year,
              (10...100).contains(age) else { return .fallback }
        return .tanaka(age: age)
    }
}
#endif
