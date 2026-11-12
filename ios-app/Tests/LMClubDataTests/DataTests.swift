import Foundation
import Testing
import LMClubDomain
@testable import LMClubData

@Suite struct WireContractTests {
    @Test func decodesTheSharedJoinReceiptFixture() throws {
        let receipt = try WireCodec.decodeJoinReceipt(Contracts.data("examples/join-receipt.json"))
        #expect(receipt.identity.auth == .guest)
        #expect(receipt.session.workoutType == .hyrox)
        #expect(receipt.session.branding.accentHex == "#FF6B00")
        #expect(receipt.session.realtime.authorizerName == "lmclub-authorizer")
        #expect(receipt.publishTopic.hasSuffix("/0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10"))
        // Uppercase UUID from Swift must be lowercased for topics / client ids.
        #expect(receipt.identity.wireID == "0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10")
    }

    @Test func decodesFixturesWithAndWithoutFractionalSeconds() throws {
        let withMillis = Data("""
        {"v":1,"athlete_id":"0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10","class_id":"5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77",
         "auth_state":"authenticated","auth_provider":"apple","display_name":"Ana","display_name_override":"Ana M.",
         "override_by":"a","override_at":"2026-11-14T12:03:00.123Z","joined_at":"2026-11-14T12:01:00.456Z"}
        """.utf8)
        let dto = try Wire.decoder().decode(AthleteIdentityDTO.self, from: withMillis)
        let identity = try dto.toDomain()
        #expect(identity.auth == .authenticated(.apple))
        #expect(identity.effectiveName == "Ana M.") // admin override wins
    }

    @Test func telemetryPayloadMatchesTheContractExactly() throws {
        let frame = TelemetryFrame(bpm: 148, effortPercent: 77.949, capturedAt: Date(timeIntervalSince1970: 1_731_360_000), sequence: 42, source: .appleWatch)
        let sent = try #require(JSONSerialization.jsonObject(with: WireCodec.encodeTelemetry(frame)) as? [String: Any])
        let example = try #require(Contracts.json("examples/heart-rate-payload.json") as? [String: Any])
        #expect(Set(sent.keys) == Set(example.keys)) // no extra (PII) fields, none missing
        #expect(sent["effort_pct"] as? Double == 77.9)
        #expect(sent["ts"] as? Int64 == 1_731_360_000_000)
        #expect(sent["source"] as? String == "apple_watch")
        #expect(sent["v"] as? Int == 1)
    }
}

@Suite struct MQTT311Tests {
    @Test func connectPacket() {
        let p = [UInt8](MQTT311.connect(clientID: "abc", keepAlive: 30))
        #expect(p == [0x10, 15, 0, 4, 0x4D, 0x51, 0x54, 0x54, 4, 0x02, 0, 30, 0, 3, 0x61, 0x62, 0x63])
    }

    @Test func publishUsesMultiByteRemainingLength() {
        let payload = Data(repeating: 0x41, count: 200)
        let p = [UInt8](MQTT311.publish(topic: "a/b", payload: payload))
        #expect(p[0] == 0x30)
        #expect(Array(p[1...2]) == [0xCD, 0x01]) // 2 + 3 + 200 = 205 = 77 + 128 -> 0xCD 0x01
        #expect(p.count == 3 + 205)
    }

    @Test func remainingLengthBoundaries() {
        #expect(MQTT311.remainingLength(127) == [0x7F])
        #expect(MQTT311.remainingLength(128) == [0x80, 0x01])
        #expect(MQTT311.remainingLength(16_383) == [0xFF, 0x7F])
    }

    @Test func connackParsing() {
        #expect(MQTT311.connackReturnCode(Data([0x20, 0x02, 0x00, 0x00])) == 0)
        #expect(MQTT311.connackReturnCode(Data([0x20, 0x02, 0x00, 0x05])) == 5) // not authorised
        #expect(MQTT311.connackReturnCode(Data([0x30, 0x00])) == nil)
    }
}

@Suite struct BLEParserTests {
    @Test func parses8And16BitAndContact() {
        #expect(HeartRateMeasurementParser.parse(Data([0x00, 72])) == 72)
        #expect(HeartRateMeasurementParser.parse(Data([0x01, 0x2C, 0x01])) == 300) // 16-bit LE
        #expect(HeartRateMeasurementParser.parse(Data([0x06, 80])) == 80)          // contact supported + detected
        #expect(HeartRateMeasurementParser.parse(Data([0x04, 80])) == nil)         // supported, not detected
        #expect(HeartRateMeasurementParser.parse(Data()) == nil)
        #expect(HeartRateMeasurementParser.parse(Data([0x01, 0x10])) == nil)       // truncated 16-bit
    }
}

private struct StubTransport: HTTPTransport {
    let status: Int
    let capture: Capture?
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        await capture?.set(request)
        return (Data(), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

private actor Capture {
    var request: URLRequest?
    func set(_ r: URLRequest) { request = r }
}

@Suite struct HTTPSPublisherTests {
    private let session = RealtimeSession(
        endpoint: .init(host: "abc-ats.iot.us-east-1.amazonaws.com", authorizerName: "lmclub-authorizer"),
        clientID: "x", credentials: .init(token: "jwt.value.sig", expiresAt: .distantFuture),
        publishTopic: "iron-house/5b1f3c8e-7a2d-4c61-9b0e-0f6a2d1c4e77/0d5c9e1a-3f4b-4d8a-8a52-6c1f7b9e2a10")
    private let frame = TelemetryFrame(bpm: 150, effortPercent: 80, capturedAt: .now, sequence: 1, source: .appleWatch)

    @Test func buildsAnIoTHttpsPublishRequest() async throws {
        let capture = Capture()
        let sut = HTTPSIoTPublisher(transport: StubTransport(status: 200, capture: capture))
        try await sut.connect(session)
        try await sut.publish(frame)
        let r = try #require(await capture.request)
        let url = try #require(r.url?.absoluteString)
        #expect(url.hasPrefix("https://abc-ats.iot.us-east-1.amazonaws.com/topics/iron-house%2F5b1f3c8e"))
        #expect(url.contains("qos=0"))
        #expect(url.contains("x-amz-customauthorizer-name=lmclub-authorizer"))
        #expect(url.contains("token=jwt.value.sig"))
        #expect(r.httpMethod == "POST")
        let body = try #require(JSONSerialization.jsonObject(with: r.httpBody!) as? [String: Any])
        #expect(body["bpm"] as? Int == 150)
    }

    @Test func mapsStatusCodes() async throws {
        for (status, expected) in [(401, TelemetryError.unauthorized), (403, .unauthorized), (503, .transient(503))] {
            let sut = HTTPSIoTPublisher(transport: StubTransport(status: status, capture: nil))
            try await sut.connect(session)
            await #expect(throws: expected) { try await sut.publish(frame) }
        }
    }

    @Test func refusesToPublishWhenNotConnected() async {
        let sut = HTTPSIoTPublisher(transport: StubTransport(status: 200, capture: nil))
        await #expect(throws: TelemetryError.notConnected) { try await sut.publish(frame) }
    }
}

@Suite struct HTTPClassRepositoryTests {
    @Test func mapsHTTPStatusToDomainErrors() async throws {
        let cases: [(Int, JoinError)] = [(404, .pinNotFoundOrExpired), (429, .tooManyAttempts), (410, .classEnded), (401, .unauthorized), (500, .network)]
        for (status, expected) in cases {
            let sut = HTTPClassRepository(baseURL: URL(string: "https://api.example.com")!, transport: StubTransport(status: status, capture: nil))
            await #expect(throws: expected) { try await sut.join(pin: "1234", displayName: "Ana", authentication: nil) }
        }
    }

    @Test func authenticatedJoinUsesBearerAndTheAuthenticatedRoute() async throws {
        let capture = Capture()
        let sut = HTTPClassRepository(baseURL: URL(string: "https://api.example.com")!, transport: StubTransport(status: 404, capture: capture))
        _ = try? await sut.join(pin: "1234", displayName: "Ana", authentication: .init(bearer: "tok"))
        let r = try #require(await capture.request)
        #expect(r.url?.path == "/join/authenticated")
        #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }
}

@Suite struct HandoffTests {
    @Test func roundTripsARealtimeSession() throws {
        let s = RealtimeSession(endpoint: .init(host: "h", authorizerName: "a"), clientID: "c",
                                credentials: .init(token: "t", expiresAt: Date(timeIntervalSince1970: 1_800_000_000)), publishTopic: "x/y/z")
        #expect(try HandoffCodec.decode(HandoffCodec.encode(s)) == s)
    }
}
