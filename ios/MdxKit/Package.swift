// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MdxKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MdxKit", targets: ["MdxKit"])
    ],
    targets: [
        .target(
            name: "MdxKit",
            linkerSettings: [.linkedLibrary("z")]
        ),
        .testTarget(
            name: "MdxKitTests",
            dependencies: ["MdxKit"]
        )
    ]
)
