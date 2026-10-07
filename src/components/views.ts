import type { LucideIcon } from "lucide-react"
import type { Space } from "@/db/schema"
import type { KindGroup, View } from "@/state/ui"
import { KIND_ICON } from "./kind-icons"

export const GROUPS: { group: KindGroup; label: string; icon: LucideIcon }[] = [
  { group: "notes", label: "Notes", icon: KIND_ICON.note },
  { group: "text", label: "Text", icon: KIND_ICON.text },
  { group: "code", label: "Code", icon: KIND_ICON.code },
  { group: "links", label: "Links", icon: KIND_ICON.link },
  { group: "colors", label: "Colors", icon: KIND_ICON.color },
  { group: "images", label: "Images", icon: KIND_ICON.image },
  { group: "media", label: "Media", icon: KIND_ICON.video },
  { group: "files", label: "Files", icon: KIND_ICON.file },
]

export function viewTitle(view: View, spaces: Space[]): string {
  switch (view.type) {
    case "write":
      return "Write"
    case "all":
      return "All clips"
    case "pinned":
      return "Pinned"
    case "trash":
      return "Trash"
    case "kind":
      return GROUPS.find((g) => g.group === view.group)?.label ?? "Clips"
    case "space":
      return spaces.find((s) => s.id === view.id)?.name ?? "Space"
  }
}

export function sameView(a: View, b: View): boolean {
  if (a.type !== b.type) return false
  if (a.type === "kind" && b.type === "kind") return a.group === b.group
  if (a.type === "space" && b.type === "space") return a.id === b.id
  return true
}
