import Foundation
import LMClubDomain

// DTOs mirror contracts/schemas/*.json 1:1 (snake_case on the wire via the coder strategies below).
// They are the ONLY types that know the wire format; Domain never sees them.

struct HeartRatePayloadDTO: Encodable {
    let v = 1
    let bpm: Int
    let effortPct: Double
    let ts: Int64
    let seq: Int
    let source: String

    init(frame: TelemetryFrame) {
        bpm = frame.bpm
        effortPct = (frame.effortPercent * 10).rounded() / 10
        ts = Int64(frame.capturedAt.timeIntervalSince1970 * 1000)
        seq = frame.sequence
        source = frame.source.rawValue
    }
}

struct BrandingDTO: Decodable {
    let clubName: String
    let logoUrl: String
    let accentColor: String
    let secondaryColor: String?
}

struct RealtimeDTO: Decodable {
    let iotEndpoint: String
    let authorizer: String
}

struct ClassSessionDTO: Decodable {
    let v: Int
    let classId: UUID
    let clubId: String
    let workoutType: String
    let status: String
    let title: String
    let startsAt: Date
    let branding: BrandingDTO
    let realtime: RealtimeDTO
}

struct AthleteIdentityDTO: Decodable {
    let v: Int
    let athleteId: UUID
    let classId: UUID
    let authState: String
    let authProvider: String?
    let displayName: String
    let displayNameOverride: String?
    let joinedAt: Date
}

struct JoinReceiptDTO: Decodable {
    struct Topics: Decodable {
        let publish: String
        let control: String
    }

    let v: Int
    let identity: AthleteIdentityDTO
    let session: ClassSessionDTO
    let token: String
    let tokenExpiresAt: Date
    let topics: Topics
}

struct JoinRequestDTO: Encodable {
    let pin: String
    let displayName: String
}

// MARK: - Wire coding

enum Wire {
    /// The backend emits `toISOString()` (with milliseconds); fixtures may omit them. Accept both.
    private static func parseDate(_ string: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: string) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }

    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            guard let date = parseDate(s) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
            }
            return date
        }
        return d
    }

    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }
}

// MARK: - Mappers (DTO -> Domain)

enum MappingError: Error { case invalid(String) }

extension ClassSessionDTO {
    func toDomain() throws -> ClassSession {
        guard let type = WorkoutType(rawValue: workoutType), let st = ClassStatus(rawValue: status) else { throw MappingError.invalid("enum") }
        guard let logo = URL(string: branding.logoUrl), logo.scheme == "https" else { throw MappingError.invalid("logo_url") }
        return ClassSession(
            id: classId, clubID: clubId, workoutType: type, status: st, title: title, startsAt: startsAt,
            branding: Branding(clubName: branding.clubName, logoURL: logo, accentHex: branding.accentColor, secondaryHex: branding.secondaryColor),
            realtime: RealtimeEndpoint(host: realtime.iotEndpoint, authorizerName: realtime.authorizer)
        )
    }
}

extension AthleteIdentityDTO {
    func toDomain() throws -> AthleteIdentity {
        let auth: AuthState
        switch (authState, authProvider.flatMap(AuthProvider.init(rawValue:))) {
        case ("guest", _): auth = .guest
        case ("authenticated", let provider?): auth = .authenticated(provider)
        default: throw MappingError.invalid("auth_state")
        }
        return AthleteIdentity(athleteID: athleteId, classID: classId, auth: auth, displayName: displayName,
                               displayNameOverride: displayNameOverride, joinedAt: joinedAt)
    }
}

extension JoinReceiptDTO {
    func toDomain() throws -> JoinReceipt {
        JoinReceipt(
            identity: try identity.toDomain(),
            session: try session.toDomain(),
            credentials: RealtimeCredentials(token: token, expiresAt: tokenExpiresAt),
            publishTopic: topics.publish,
            controlTopic: topics.control
        )
    }
}

public enum WireCodec {
    /// Encodes the exact bytes published on the telemetry topic.
    public static func encodeTelemetry(_ frame: TelemetryFrame) throws -> Data {
        try Wire.encoder().encode(HeartRatePayloadDTO(frame: frame))
    }

    public static func decodeJoinReceipt(_ data: Data) throws -> JoinReceipt {
        try Wire.decoder().decode(JoinReceiptDTO.self, from: data).toDomain()
    }
}
