import SwiftUI
import LMClubDomain

/// Zone-coloured live readout; identical on iPhone and Apple Watch.
public struct LiveEffortView: View {
    private let model: LiveEffortViewModel

    public init(model: LiveEffortViewModel) { self.model = model }

    public var body: some View {
        VStack(spacing: 4) {
            Text(model.bpm.map(String.init) ?? "--")
                .font(.system(size: 72, weight: .heavy, design: .rounded))
                .contentTransition(.numericText())
            Text("BPM").font(.caption).opacity(0.8)
            Text("\(Int(model.effortPercent))% · \(model.zone.rawValue.capitalized)").font(.headline)
        }
        .foregroundStyle(.black)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(model.zone.color)
        .animation(.easeOut(duration: 0.4), value: model.zone)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Heart rate \(model.bpm ?? 0) beats per minute, \(model.zone.rawValue) zone")
    }
}
