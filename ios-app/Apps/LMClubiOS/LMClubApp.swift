import SwiftUI
import WatchConnectivity
import LMClubDomain
import LMClubData
import LMClubPresentation

/// Composition root: the only place that sees every layer and wires concrete adapters to ports.
@MainActor
final class AppContainer {
    let liveEffort = LiveEffortViewModel()
    let stream: StreamHeartRateUseCase
    let joinViewModel: JoinClassViewModel
    private let watchBridge = PhoneWatchBridge()

    init() {
        guard let base = (Bundle.main.object(forInfoDictionaryKey: "LMClubAPIBaseURL") as? String).flatMap(URL.init(string:)) else {
            fatalError("LMClubAPIBaseURL missing from Info.plist")
        }
        // iPhone has no low-level networking restriction, so it keeps a persistent MQTT/WebSocket connection.
        let publisher = ResilientTelemetryPublisher(wrapping: WebSocketMQTTPublisher())
        let stream = StreamHeartRateUseCase(publisher: publisher, maxHeartRateProvider: DefaultMaxHeartRate())
        self.stream = stream
        let live = liveEffort
        let bridge = watchBridge

        joinViewModel = JoinClassViewModel(
            joinClass: JoinClassUseCase(repository: HTTPClassRepository(baseURL: base)),
            onJoined: { receipt in
                await stream.setObserver(live.observer())
                // 1) Apple Watch path: hand the short-lived, topic-scoped token to the watch, which publishes itself.
                bridge.send(session: receipt.realtimeSession)
                // 2) BLE strap path: this phone is the hub (UIBackgroundModes: bluetooth-central).
                try? await stream.begin(receipt.realtimeSession)
                Task { try? await stream.run(source: CoreBluetoothHeartRateSource()) }
            }
        )
    }
}

/// Max HR is user-configurable on the phone; until set, a conservative default is used. Never transmitted.
struct DefaultMaxHeartRate: MaxHeartRateProviding {
    func maxHeartRate() async -> MaxHeartRate {
        let age = UserDefaults.standard.integer(forKey: "athleteAge")
        return age > 0 ? .tanaka(age: age) : .fallback
    }
}

final class PhoneWatchBridge: NSObject, WCSessionDelegate, @unchecked Sendable {
    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(session: RealtimeSession) {
        guard WCSession.default.activationState == .activated, WCSession.default.isWatchAppInstalled,
              let data = try? HandoffCodec.encode(session) else { return }
        try? WCSession.default.updateApplicationContext(["session": data])
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}

@main
struct LMClubApp: App {
    @State private var container = AppContainer()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                switch container.joinViewModel.state {
                case .joined: LiveEffortView(model: container.liveEffort)
                default: JoinClassView(model: container.joinViewModel).navigationTitle("Join a class")
                }
            }
        }
    }
}
