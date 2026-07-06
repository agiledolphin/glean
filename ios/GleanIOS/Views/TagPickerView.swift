import SwiftUI

struct TagPickerView: View {
    let allTags: [Tag]
    let activeTagIds: Set<Int64>
    let onToggle: (Int64) -> Void
    let onCreate: (String, String) -> Void
    let onDelete: (Int64) -> Void
    let onSetDefault: (Int64?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var newTagName = ""
    @State private var newTagColor = TagPickerView.presetColors[0]

    static let presetColors = ["#4385be", "#3aa99f", "#8b7ec8", "#879a39", "#da702c"]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if allTags.isEmpty {
                        Text("还没有标签")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(allTags, id: \.name) { tag in
                            tagRow(tag)
                        }
                        .onDelete { offsets in
                            for index in offsets {
                                if let id = allTags[index].id { onDelete(id) }
                            }
                        }
                    }
                } footer: {
                    if !allTags.isEmpty {
                        Text("点星标设为默认标签，收藏单词时会自动关联")
                    }
                }

                Section("新建标签") {
                    HStack(spacing: 10) {
                        ForEach(Self.presetColors, id: \.self) { hex in
                            Circle()
                                .fill(Color(hex: hex))
                                .frame(width: 22, height: 22)
                                .overlay(
                                    Circle().stroke(Color.primary, lineWidth: newTagColor == hex ? 2 : 0)
                                )
                                .onTapGesture { newTagColor = hex }
                        }
                    }
                    HStack {
                        TextField("标签名称", text: $newTagName)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("添加") {
                            onCreate(newTagName, newTagColor)
                            newTagName = ""
                        }
                        .disabled(newTagName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .navigationTitle("选择标签")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func tagRow(_ tag: Tag) -> some View {
        let isActive = tag.id.map { activeTagIds.contains($0) } ?? false
        HStack {
            Button {
                onSetDefault(tag.isDefault ? nil : tag.id)
            } label: {
                Image(systemName: tag.isDefault ? "star.fill" : "star")
                    .foregroundStyle(tag.isDefault ? .yellow : .secondary)
            }
            .buttonStyle(.plain)

            Circle()
                .fill(Color(hex: tag.color))
                .frame(width: 10, height: 10)
            Text(tag.name)
                .foregroundStyle(.primary)
            Spacer()
            if isActive {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color.accentColor)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let id = tag.id { onToggle(id) }
        }
    }
}
