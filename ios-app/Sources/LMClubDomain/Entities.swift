import Foundation

// MARK: - Telemetry

public enum SensorSource: String, Sendable {
    case appleWatch = "apple_watch"
    case bleStrap = "ble_strap"
}

/// Raw reading from a sensor (HealthKit or BLE).
public struct HeartRateSample: Sendable, Equatable {
    public let bpm: Int
    public let capturedAt: Date
    public let source: SensorSource

    public init(bpm: Int, capturedAt: Date, source: SensorSource) {
        self.bpm = bpm
        self.capturedAt = capturedAt
        self.source = source
    }
}

/// What leaves the device. Deliberately has no identity fields: the athlete is the topic.
public struct TelemetryFrame: Sendable, Equatable {
    public let bpm: Int
    public let effortPercent: Double
    public let capturedAt: Date
    public let sequence: Int
    public let source: SensorSource

    public init(bpm: Int, effortPercent: Double, capturedAt: Date, sequence: Int, source: SensorSource) {
        self.bpm = bpm
        self.effortPercent = effortPercent
        self.capturedAt = capturedAt
        self.sequence = sequence
        self.source = source
    }

    public var zone: EffortZone { .zone(forEffortPercent: effortPercent) }
}

// MARK: - Class

public enum WorkoutType: String, Sendable, CaseIterable {
    case hyrox
    case indoorCycling = "indoor_cycling"
    case hiit
}

public enum ClassStatus: String, Sendable {
    case scheduled, live, completed
}

public struct Branding: Sendable, Equatable {
    public let clubName: String
    public let logoURL: URL
    public let accentHex: String
    public let secondaryHex: String?

    public init(clubName: String, logoURL: URL, accentHex: String, secondaryHex: String?) {
        self.clubName = clubName
        self.logoURL = logoURL
        self.accentHex = accentHex
        self.secondaryHex = secondaryHex
    }
}

public struct RealtimeEndpoint: Sendable, Equatable {
    public let host: String
    public let authorizerName: String

    public init(host: String, authorizerName: String) {
        self.host = host
        self.authorizerName = authorizerName
    }
}

public struct ClassSession: Sendable, Equatable {
    public let id: UUID
    public let clubID: String
    public let workoutType: WorkoutType
    public let status: ClassStatus
    public let title: String
    public let startsAt: Date
    public let branding: Branding
    public let realtime: RealtimeEndpoint

    public init(id: UUID, clubID: String, workoutType: WorkoutType, status: ClassStatus, title: String,
                startsAt: Date, branding: Branding, realtime: RealtimeEndpoint) {
        self.id = id
        self.clubID = clubID
        self.workoutType = workoutType
        self.status = status
        self.title = title
        self.startsAt = startsAt
        self.branding = branding
        self.realtime = realtime
    }
}

// MARK: - Identity

public enum AuthProvider: String, Sendable {
    case apple, google, email
}

public enum AuthState: Sendable, Equatable {
    case guest
    case authenticated(AuthProvider)
}

public struct AthleteIdentity: Sendable, Equatable {
    /// Class-scoped pseudonym minted by the backend; the only id that appears in telemetry.
    public let athleteID: UUID
    public let classID: UUID
    public let auth: AuthState
    public let displayName: String
    /// Club Admin correction; wins over `displayName` on the TV.
    public let displayNameOverride: String?
    public let joinedAt: Date

    public init(athleteID: UUID, classID: UUID, auth: AuthState, displayName: String,
                displayNameOverride: String?, joinedAt: Date) {
        self.athleteID = athleteID
        self.classID = classID
        self.auth = auth
        self.displayName = displayName
        self.displayNameOverride = displayNameOverride
        self.joinedAt = joinedAt
    }

    public var effectiveName: String { displayNameOverride ?? displayName }

    /// Topic segments and MQTT client ids are lowercase on the wire; `UUID.uuidString` is uppercase.
    public var wireID: String { athleteID.uuidString.lowercased() }
}

public struct RealtimeCredentials: Sendable, Equatable {
    public let token: String
    public let expiresAt: Date

    public init(token: String, expiresAt: Date) {
        self.token = token
        self.expiresAt = expiresAt
    }
}

public struct JoinReceipt: Sendable, Equatable {
    public let identity: AthleteIdentity
    public let session: ClassSession
    public let credentials: RealtimeCredentials
    /// Server-provided: never reconstruct topics client-side.
    public let publishTopic: String
    public let controlTopic: String

    public init(identity: AthleteIdentity, session: ClassSession, credentials: RealtimeCredentials,
                publishTopic: String, controlTopic: String) {
        self.identity = identity
        self.session = session
        self.credentials = credentials
        self.publishTopic = publishTopic
        self.controlTopic = controlTopic
    }

    public var realtimeSession: RealtimeSession {
        RealtimeSession(endpoint: session.realtime, clientID: identity.wireID, credentials: credentials, publishTopic: publishTopic)
    }
}

/// Everything a `TelemetryPublisher` needs to talk to the realtime layer.
public struct RealtimeSession: Sendable, Equatable {
    public let endpoint: RealtimeEndpoint
    public let clientID: String
    public let credentials: RealtimeCredentials
    public let publishTopic: String

    public init(endpoint: RealtimeEndpoint, clientID: String, credentials: RealtimeCredentials, publishTopic: String) {
        self.endpoint = endpoint
        self.clientID = clientID
        self.credentials = credentials
        self.publishTopic = publishTopic
    }
}

/// Opaque bearer for the authenticated join (Sign in with Apple / Google / email via Cognito).
public struct AuthenticationToken: Sendable, Equatable {
    public let bearer: String
    public init(bearer: String) { self.bearer = bearer }
}
