import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            SearchView()
                .tabItem {
                    Label("查词", systemImage: "magnifyingglass")
                }

            VocabularyView()
                .tabItem {
                    Label("生词本", systemImage: "book")
                }

            ReviewView()
                .tabItem {
                    Label("背单词", systemImage: "graduationcap")
                }
        }
    }
}
