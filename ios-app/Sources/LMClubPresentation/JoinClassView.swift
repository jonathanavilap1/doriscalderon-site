import SwiftUI
import LMClubDomain

public struct JoinClassView: View {
    @Bindable private var model: JoinClassViewModel
    @FocusState private var focus: Field?
    private enum Field { case pin, name }

    public init(model: JoinClassViewModel) { self.model = model }

    public var body: some View {
        Form {
            Section("Class PIN") {
                TextField("4-digit PIN on the TV", text: $model.pin)
                    .focused($focus, equals: .pin)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .textContentType(.oneTimeCode)
                    .font(.system(.title, design: .monospaced))
            }
            Section("Your name on the leaderboard") {
                TextField("Display name", text: $model.displayName)
                    .focused($focus, equals: .name)
                    .submitLabel(.go)
                    .onSubmit { Task { await model.submit() } }
            }
            if case .failed(let message) = model.state {
                Text(message).foregroundStyle(.red).accessibilityLabel("Error: \(message)")
            }
            Button {
                Task { await model.submit() }
            } label: {
                if model.state == .joining { ProgressView() } else { Text("Join class").frame(maxWidth: .infinity) }
            }
            .disabled(!model.canSubmit)
        }
        .onAppear { focus = .pin }
    }
}
