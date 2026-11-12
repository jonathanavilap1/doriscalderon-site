import Foundation

/// Effort zones. Thresholds and points mirror `contracts/zones.json`; a test enforces parity.
public enum EffortZone: String, CaseIterable, Sendable {
    case gray, blue, green, orange, red

    public var minimumPercent: Double {
        switch self {
        case .gray: 0
        case .blue: 60
        case .green: 70
        case .orange: 84
        case .red: 92
        }
    }

    public var pointsPerMinute: Double {
        switch self {
        case .gray: 0
        case .blue: 1
        case .green: 2
        case .orange: 3
        case .red: 4
        }
    }

    /// `allCases` is ordered by ascending threshold, so the last zone whose floor is reached wins.
    public static func zone(forEffortPercent percent: Double) -> EffortZone {
        allCases.last { percent >= $0.minimumPercent } ?? .gray
    }
}
