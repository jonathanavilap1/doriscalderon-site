import Foundation
import Testing
@testable import LMClubDomain

@Suite struct EffortZoneContractTests {
    @Test func matchesZonesJSON() throws {
        let json = try #require(Contracts.json("zones.json") as? [String: Any])
        let zones = try #require(json["zones"] as? [[String: Any]])
        #expect(zones.count == EffortZone.allCases.count)
        for entry in zones {
            let zone = try #require(EffortZone(rawValue: entry["name"] as! String))
            #expect(zone.minimumPercent == (entry["min_pct"] as! NSNumber).doubleValue)
            #expect(zone.pointsPerMinute == (entry["points_per_minute"] as! NSNumber).doubleValue)
        }
    }

    @Test func matchesCrossLanguageVectors() throws {
        let vectors = try #require(Contracts.json("examples/zone-vectors.json") as? [[String: Any]])
        for v in vectors {
            let pct = (v["effort_pct"] as! NSNumber).doubleValue
            #expect(EffortZone.zone(forEffortPercent: pct).rawValue == v["zone"] as? String, "at \(pct)%")
        }
    }
}

@Suite struct MaxHeartRateTests {
    @Test func tanakaAndEffort() {
        #expect(MaxHeartRate.tanaka(age: 30).bpm == 187)
        #expect(MaxHeartRate.tanaka(age: 30).effortPercent(forBPM: 187) == 100)
        #expect(MaxHeartRate.tanaka(age: 30).effortPercent(forBPM: 400) == 150) // contract cap
        #expect(MaxHeartRate(bpm: 50) == nil)
    }
}

private actor SpyPublisher: TelemetryPublisher {
    var frames: [TelemetryFrame] = []
    var connected: RealtimeSession?
    var failWith: TelemetryError?
    func connect(_ session: RealtimeSession) async throws { connected = session }
    func publish(_ frame: TelemetryFrame) async throws {
        if let failWith { throw failWith }
        frames.append(frame)
    }
    func disconnect() async { connected = nil }
    func setFailure(_ e: TelemetryError?) { failWith = e }
}

private struct FixedMax: MaxHeartRateProviding {
    func maxHeartRate() async -> MaxHeartRate { MaxHeartRate(bpm: 200)! }
}

private let session = RealtimeSession(
    endpoint: .init(host: "x-ats.iot.us-east-1.amazonaws.com", authorizerName: "lmclub-authorizer"),
    clientID: "id", credentials: .init(token: "t", expiresAt: .distantFuture), publishTopic: "club/class/id")

@Suite struct StreamHeartRateUseCaseTests {
    private func sample(_ bpm: Int, at t: TimeInterval) -> HeartRateSample {
        HeartRateSample(bpm: bpm, capturedAt: Date(timeIntervalSince1970: t), source: .appleWatch)
    }

    @Test func computesEffortOnDeviceAndSequencesFrames() async throws {
        let spy = SpyPublisher()
        let sut = StreamHeartRateUseCase(publisher: spy, maxHeartRateProvider: FixedMax())
        try await sut.begin(session)
        await sut.ingest(sample(180, at: 0))
        await sut.ingest(sample(100, at: 1))
        let frames = await spy.frames
        #expect(frames.map(\.sequence) == [0, 1])
        #expect(frames[0].effortPercent == 90)
        #expect(frames[0].zone == .orange)
        #expect(frames[1].zone == .gray)
    }

    @Test func throttlesAndRejectsImpossibleReadings() async throws {
        let spy = SpyPublisher()
        let sut = StreamHeartRateUseCase(publisher: spy, maxHeartRateProvider: FixedMax(), minimumInterval: 1)
        try await sut.begin(session)
        await sut.ingest(sample(150, at: 0))
        await sut.ingest(sample(151, at: 0.4)) // too soon
        await sut.ingest(sample(10, at: 2))    // below 30 bpm: sensor glitch
        await sut.ingest(sample(152, at: 2))
        #expect(await spy.frames.map(\.bpm) == [150, 152])
    }

    @Test func ignoresSamplesBeforeBeginAndAfterEnd() async throws {
        let spy = SpyPublisher()
        let sut = StreamHeartRateUseCase(publisher: spy, maxHeartRateProvider: FixedMax())
        await sut.ingest(sample(150, at: 0))
        try await sut.begin(session)
        await sut.end()
        await sut.ingest(sample(150, at: 5))
        #expect(await spy.frames.isEmpty)
    }

    @Test func dropsFramesOnTransientFailureButStopsOnUnauthorized() async throws {
        let spy = SpyPublisher()
        let sut = StreamHeartRateUseCase(publisher: spy, maxHeartRateProvider: FixedMax())
        try await sut.begin(session)
        await spy.setFailure(.transient(503))
        await sut.ingest(sample(150, at: 0))
        await spy.setFailure(nil)
        await sut.ingest(sample(151, at: 2))
        #expect(await spy.frames.map(\.bpm) == [151]) // carried on after the drop

        await spy.setFailure(.unauthorized)
        await sut.ingest(sample(152, at: 4))
        await spy.setFailure(nil)
        await sut.ingest(sample(153, at: 6))
        #expect(await spy.frames.map(\.bpm) == [151]) // deactivated: no further publishing with a dead token
    }

    @Test func observerSeesFramesEvenWhenNetworkFails() async throws {
        let spy = SpyPublisher()
        await spy.setFailure(.transient(500))
        let sut = StreamHeartRateUseCase(publisher: spy, maxHeartRateProvider: FixedMax())
        let seen = Seen()
        await sut.setObserver { frame in Task { await seen.add(frame.bpm) } }
        try await sut.begin(session)
        await sut.ingest(sample(150, at: 0))
        try await Task.sleep(for: .milliseconds(50))
        #expect(await seen.values == [150])
    }
}

private actor Seen {
    var values: [Int] = []
    func add(_ v: Int) { values.append(v) }
}

@Suite struct JoinClassUseCaseTests {
    private struct Repo: ClassRepository {
        func join(pin: String, displayName: String, authentication: AuthenticationToken?) async throws -> JoinReceipt {
            throw JoinError.network
        }
    }

    @Test func validatesBeforeHittingTheNetwork() async {
        let sut = JoinClassUseCase(repository: Repo())
        await #expect(throws: JoinError.invalidPIN) { try await sut.execute(pin: "12a4", displayName: "Ana") }
        await #expect(throws: JoinError.invalidPIN) { try await sut.execute(pin: "123", displayName: "Ana") }
        await #expect(throws: JoinError.invalidDisplayName) { try await sut.execute(pin: "1234", displayName: "   ") }
        await #expect(throws: JoinError.invalidDisplayName) { try await sut.execute(pin: "1234", displayName: String(repeating: "x", count: 25)) }
        await #expect(throws: JoinError.network) { try await sut.execute(pin: "1234", displayName: "Ana") } // reached repo
    }
}
