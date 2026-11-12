import Foundation
import Observation
import LMClubDomain

@MainActor
@Observable
public final class JoinClassViewModel {
    public enum State: Equatable {
        case idle
        case joining
        case joined(JoinReceipt)
        case failed(String)
    }

    public var pin = "" { didSet { pin = String(pin.filter(\.isASCII).filter(\.isNumber).prefix(4)) } }
    public var displayName = ""
    public private(set) var state: State = .idle

    private let joinClass: JoinClassUseCase
    private let authentication: @Sendable () async -> AuthenticationToken?
    private let onJoined: @Sendable (JoinReceipt) async -> Void

    /// - Parameters:
    ///   - authentication: returns a token when the athlete is signed in (Authenticated Mode), nil for Guest Mode.
    ///   - onJoined: composition-root hook (start the workout / BLE hub); keeps this type ignorant of both.
    public init(joinClass: JoinClassUseCase,
                authentication: @escaping @Sendable () async -> AuthenticationToken? = { nil },
                onJoined: @escaping @Sendable (JoinReceipt) async -> Void) {
        self.joinClass = joinClass
        self.authentication = authentication
        self.onJoined = onJoined
    }

    public var canSubmit: Bool {
        pin.count == 4 && !displayName.trimmingCharacters(in: .whitespaces).isEmpty && state != .joining
    }

    public func submit() async {
        guard canSubmit else { return }
        state = .joining
        do {
            let receipt = try await joinClass.execute(pin: pin, displayName: displayName, authentication: await authentication())
            state = .joined(receipt)
            await onJoined(receipt)
        } catch let error as JoinError {
            state = .failed(Self.message(for: error))
        } catch {
            state = .failed(Self.message(for: .network))
        }
    }

    static func message(for error: JoinError) -> String {
        switch error {
        case .invalidPIN: "Enter the 4-digit PIN shown on the TV."
        case .invalidDisplayName: "Choose a name up to \(JoinClassUseCase.maxDisplayNameLength) characters."
        case .pinNotFoundOrExpired: "That PIN is wrong or has expired. Check the TV."
        case .tooManyAttempts: "Too many attempts. Wait a few minutes and try again."
        case .classEnded: "This class has already finished."
        case .unauthorized: "Please sign in again."
        case .network: "Can't reach LM Club. Check your connection."
        }
    }
}
