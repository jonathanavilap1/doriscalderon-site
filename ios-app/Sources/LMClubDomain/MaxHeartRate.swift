import Foundation

/// Max heart rate stays on the device: only the derived `effortPercent` is ever transmitted.
public struct MaxHeartRate: Sendable, Equatable {
    public static let fallback = MaxHeartRate(uncheckedBPM: 190)
    public let bpm: Int

    public init?(bpm: Int) {
        guard (120...230).contains(bpm) else { return nil }
        self.bpm = bpm
    }

    private init(uncheckedBPM: Int) { bpm = uncheckedBPM }

    /// Tanaka et al. (2001): 208 − 0.7 × age. More accurate than 220 − age for adults.
    public static func tanaka(age: Int) -> MaxHeartRate {
        let estimate = Int((208.0 - 0.7 * Double(age)).rounded())
        return MaxHeartRate(bpm: estimate) ?? .fallback
    }

    /// Matches the contract bound (0...150).
    public func effortPercent(forBPM bpm: Int) -> Double {
        min(150, max(0, Double(bpm) / Double(self.bpm) * 100))
    }
}
