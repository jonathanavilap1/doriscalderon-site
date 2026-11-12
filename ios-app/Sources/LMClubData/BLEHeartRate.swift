import Foundation
import LMClubDomain

/// GATT Heart Rate Measurement (0x2A37) parsing, kept pure so it is unit-testable.
public enum HeartRateMeasurementParser {
    /// Returns nil when the strap reports no skin contact or the packet is malformed.
    public static func parse(_ data: Data) -> Int? {
        let b = [UInt8](data)
        guard let flags = b.first else { return nil }
        let is16Bit = flags & 0x01 != 0
        let contactSupported = flags & 0x04 != 0
        let contactDetected = flags & 0x02 != 0
        if contactSupported && !contactDetected { return nil }
        if is16Bit {
            guard b.count >= 3 else { return nil }
            return Int(b[1]) | (Int(b[2]) << 8)
        }
        guard b.count >= 2 else { return nil }
        return Int(b[1])
    }
}

#if canImport(CoreBluetooth)
@preconcurrency import CoreBluetooth

/// BLE hub for generic chest straps (service 0x180D). Requires `UIBackgroundModes: bluetooth-central`.
/// State restoration lets iOS relaunch the app and hand back the connected strap after a jetsam/termination.
public final class CoreBluetoothHeartRateSource: NSObject, HeartRateSource, @unchecked Sendable {
    public static let restoreIdentifier = "club.lm.ble-central"
    private static let service = CBUUID(string: "180D")
    private static let measurement = CBUUID(string: "2A37")

    public let samples: AsyncStream<HeartRateSample>
    private let continuation: AsyncStream<HeartRateSample>.Continuation
    private let queue = DispatchQueue(label: "club.lm.ble")
    private let now: @Sendable () -> Date
    private var central: CBCentralManager?
    private var strap: CBPeripheral?
    private var startContinuation: CheckedContinuation<Void, Error>?

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        (samples, continuation) = AsyncStream.makeStream(of: HeartRateSample.self, bufferingPolicy: .bufferingNewest(1))
        self.now = now
        super.init()
    }

    public func start() async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            queue.async {
                self.startContinuation = c
                // Delegate callbacks (centralManagerDidUpdateState) resume the continuation once powered on.
                self.central = CBCentralManager(delegate: self, queue: self.queue, options: [CBCentralManagerOptionRestoreIdentifierKey: Self.restoreIdentifier])
            }
        }
    }

    public func stop() async {
        queue.async {
            self.central?.stopScan()
            if let strap = self.strap { self.central?.cancelPeripheralConnection(strap) }
            self.continuation.finish()
        }
    }
}

extension CoreBluetoothHeartRateSource: CBCentralManagerDelegate, CBPeripheralDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            startContinuation?.resume()
            startContinuation = nil
            if strap == nil { central.scanForPeripherals(withServices: [Self.service]) }
        case .unauthorized, .unsupported:
            startContinuation?.resume(throwing: TelemetryError.notConnected)
            startContinuation = nil
        default: break
        }
    }

    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard let restored = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first else { return }
        strap = restored
        restored.delegate = self
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        strap = peripheral
        peripheral.delegate = self
        central.stopScan()
        central.connect(peripheral)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.service])
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        central.connect(peripheral) // pending connect: iOS reconnects when the strap is back in range, even in background
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        peripheral.services?.forEach { peripheral.discoverCharacteristics([Self.measurement], for: $0) }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        service.characteristics?.filter { $0.uuid == Self.measurement }.forEach { peripheral.setNotifyValue(true, for: $0) }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value, let bpm = HeartRateMeasurementParser.parse(data) else { return }
        continuation.yield(HeartRateSample(bpm: bpm, capturedAt: now(), source: .bleStrap))
    }
}
#endif
