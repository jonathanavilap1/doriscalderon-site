import SwiftUI
import LMClubDomain

public extension EffortZone {
    /// Same palette as contracts/zones.json so the phone, watch and TV agree.
    var color: Color {
        switch self {
        case .gray: Color(hex: 0x8E8E93)
        case .blue: Color(hex: 0x0A84FF)
        case .green: Color(hex: 0x30D158)
        case .orange: Color(hex: 0xFF9F0A)
        case .red: Color(hex: 0xFF453A)
        }
    }
}

public extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    /// Parses `#RRGGBB`; nil for anything else (branding is tenant-supplied, so never trust it blindly).
    init?(brandingHex: String) {
        guard brandingHex.count == 7, brandingHex.hasPrefix("#"), let v = UInt32(brandingHex.dropFirst(), radix: 16) else { return nil }
        self.init(hex: v)
    }
}
