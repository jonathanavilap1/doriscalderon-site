import SwiftUI
import HealthKit
import WatchConnectivity
import LMClubDomain
import LMClubData
import LMClubPresentation
import LMClubWorkout

/// Watch composition root. Dependency direction: WorkoutManager -> HeartRateSink (use case) -> TelemetryPublisher.
@MainActor
@Observable
final class WatchContainer: NSObject, WCSessionDelegate {
    let liveEffort = LiveEffortViewModel()
    let stream: StreamHeartRateUseCase
    let workout: WorkoutManager

    override init() {
        // HTTPS publisher: watchOS blocks WebSocket/NWConnection (TN3135); URLSession HTTP is allowed and iPhone-proxied.
        // 2s cadence trades a little TV smoothness for much better battery over HTTPS.
        let stream = StreamHeartRateUseCase(publisher: HTTPSIoTPublisher(), maxHeartRateProvider: HealthKitMaxHeartRateProvider(), minimumInterval: 2)
        self.stream = stream
        workout = WorkoutManager(sink: stream)
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
        Task { await stream.setObserver(liveEffort.observer()) }
    }

    func start(with session: RealtimeSession) async {
        do {
            try await workout.requestAuthorization()
            try await stream.begin(session)
            try await workout.start(activity: .highIntensityIntervalTraining)
        } catch {
            await stream.end()
        }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        guard let data = context["session"] as? Data, let rt = try? HandoffCodec.decode(data) else { return }
        Task { @MainActor in await self.start(with: rt) }
    }
}

@main
struct LMClubWatchApp: App {
    @State private var container = WatchContainer()

    var body: some Scene {
        WindowGroup {
            LiveEffortView(model: container.liveEffort)
                .overlay(alignment: .bottom) {
                    if container.workout.state == .running {
                        Button("End") { container.workout.end(); Task { await container.stream.end() } }
                    }
                }
        }
    }
}
