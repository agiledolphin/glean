import SwiftUI

private struct DictManagerKey: EnvironmentKey {
    static let defaultValue = DictManager()
}

extension EnvironmentValues {
    var dictManager: DictManager {
        get { self[DictManagerKey.self] }
        set { self[DictManagerKey.self] = newValue }
    }
}
