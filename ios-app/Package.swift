// swift-tools-version: 6.0
import PackageDescription

// Clean Architecture, enforced by the dependency graph:
//   Domain  <- nothing (pure Swift: entities, ports, use cases)
//   Data    <- Domain (DTOs, mappers, MQTT/HTTPS/BLE adapters)
//   Presentation <- Domain (SwiftUI + view models; never imports Data)
//   Workout <- Domain (HealthKit adapter for watchOS; never imports Data)
// Only the app targets (composition roots in Apps/) see all layers.
let package = Package(
    name: "LMClubKit",
    platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v14)],
    products: [
        .library(name: "LMClubDomain", targets: ["LMClubDomain"]),
        .library(name: "LMClubData", targets: ["LMClubData"]),
        .library(name: "LMClubPresentation", targets: ["LMClubPresentation"]),
        .library(name: "LMClubWorkout", targets: ["LMClubWorkout"]),
    ],
    targets: [
        .target(name: "LMClubDomain"),
        .target(name: "LMClubData", dependencies: ["LMClubDomain"]),
        .target(name: "LMClubPresentation", dependencies: ["LMClubDomain"]),
        .target(name: "LMClubWorkout", dependencies: ["LMClubDomain"]),
        .testTarget(name: "LMClubDomainTests", dependencies: ["LMClubDomain"]),
        .testTarget(name: "LMClubDataTests", dependencies: ["LMClubData", "LMClubDomain"]),
    ]
)
