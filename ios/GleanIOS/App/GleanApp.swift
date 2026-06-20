import SwiftUI

@main
struct GleanApp: App {
    @State private var dictManager = DictManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.appDatabase, AppDatabase.shared)
                .environment(\.dictManager, dictManager)
                .task { await dictManager.preload() }
        }
    }
}
