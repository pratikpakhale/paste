import { useEffect } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ClipList } from "@/components/clip-list"
import { DetailPane } from "@/components/clip-detail"
import { CommandPalette } from "@/components/command-palette"
import { DragLayer } from "@/components/drag-layer"
import { ListHeader } from "@/components/list-header"
import { Composer, ConfirmDialog, DropZone, QueueBar, ShortcutsDialog } from "@/components/overlays"
import { Sidebar } from "@/components/sidebar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { purgeExpiredTrash } from "@/db/actions"
import { usePasteCapture, useShortcuts } from "@/hooks/use-shortcuts"
import { useActions } from "@/state/actions"
import { useUi } from "@/state/ui"

export function App() {
  const actions = useActions()
  usePasteCapture(actions)
  useShortcuts(actions)
  const layout = useDefaultLayout({ id: "paste:panes", storage: localStorage })

  useEffect(() => {
    void purgeExpiredTrash()
    // Ask the browser not to evict the library under storage pressure. The Storage API only exists
    // in secure contexts, so it's missing when the app is opened over plain http (e.g. a LAN IP).
    if ("storage" in navigator) void navigator.storage.persist()
    // The installed app's "New clip" shortcut launches with `?new`.
    const url = new URL(location.href)
    if (url.searchParams.has("new")) {
      url.searchParams.delete("new")
      history.replaceState(null, "", url)
      useUi.getState().setOverlay("composer")
    }
  }, [])

  return (
    <DragLayer>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="min-w-0 flex-1 py-2 pr-2">
          <div className="h-full overflow-hidden rounded-lg border bg-background shadow-[0_1px_3px_oklch(0_0_0/0.04)] dark:shadow-none">
            <ResizablePanelGroup id="paste:panes" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
              <ResizablePanel id="list" defaultSize="54" minSize={320}>
                <section className="flex h-full min-w-0 flex-col">
                  <ListHeader />
                  <ClipList />
                </section>
              </ResizablePanel>
              <ResizableHandle className="bg-border" />
              <ResizablePanel id="detail" defaultSize="46" minSize={340}>
                <DetailPane />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </main>
      </div>
      <QueueBar />
      <DropZone />
      <CommandPalette />
      <Composer />
      <ShortcutsDialog />
      <ConfirmDialog />
    </DragLayer>
  )
}
