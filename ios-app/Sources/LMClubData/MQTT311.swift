import Foundation

/// Minimal MQTT 3.1.1 codec: only what a publish-only edge client needs (CONNECT, PUBLISH QoS 0, PING, DISCONNECT).
enum MQTT311 {
    static let pingRequest = Data([0xC0, 0x00])
    static let disconnect = Data([0xE0, 0x00])

    static func connect(clientID: String, keepAlive: UInt16, username: String? = nil, password: String? = nil) -> Data {
        var flags: UInt8 = 0x02 // clean session
        var payload = string(clientID)
        if let username { flags |= 0x80; payload += string(username) }
        if let password { flags |= 0x40; payload += string(password) }
        var variable = string("MQTT")
        variable += [0x04, flags, UInt8(keepAlive >> 8), UInt8(keepAlive & 0xFF)]
        return packet(type: 0x10, body: variable + payload)
    }

    static func publish(topic: String, payload: Data) -> Data {
        packet(type: 0x30, body: string(topic) + payload) // DUP=0, QoS=0, RETAIN=0
    }

    /// CONNACK return code, or nil if `data` is not a well-formed CONNACK.
    static func connackReturnCode(_ data: Data) -> UInt8? {
        let b = [UInt8](data)
        guard b.count >= 4, b[0] == 0x20, b[1] == 0x02 else { return nil }
        return b[3]
    }

    static func isPingResponse(_ data: Data) -> Bool { [UInt8](data).starts(with: [0xD0, 0x00]) }

    // MARK: encoding helpers

    static func remainingLength(_ length: Int) -> [UInt8] {
        var n = length
        var out: [UInt8] = []
        repeat {
            var byte = UInt8(n % 128)
            n /= 128
            if n > 0 { byte |= 0x80 }
            out.append(byte)
        } while n > 0
        return out
    }

    private static func string(_ s: String) -> Data {
        let utf8 = Data(s.utf8)
        return Data([UInt8(utf8.count >> 8), UInt8(utf8.count & 0xFF)]) + utf8
    }

    private static func packet(type: UInt8, body: Data) -> Data {
        Data([type]) + Data(remainingLength(body.count)) + body
    }
}
