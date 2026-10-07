import { useEffect } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ClipList } from "@/components/clip-list"
import { DetailPane } from "@/components/clip-detail"
import { CommandPalette } from "@/components/command-palette"
import { DragLayer } from "@/components/drag-layer"
import { ListHeader } from "@/components/list-header"
import { ConfirmDialog, DropZone, QueueBar, ShortcutsDialog } from "@/components/overlays"
import { Sidebar, SidebarToggle } from "@/components/sidebar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { WritePane } from "@/components/write-pane"
import { purgeExpiredTrash, sweepNotes } from "@/db/actions"
import { usePasteCapture } from "@/hooks/use-page-input"
import { useShortcuts } from "@/hooks/use-shortcuts"
import { cn } from "@/lib/utils"
import { useActions } from "@/state/actions"
import { startSession } from "@/state/notes"
import { useUi } from "@/state/ui"

export function App() {
  const actions = useActions()
  usePasteCapture(actions)
  useShortcuts(actions)
  const layout = useDefaultLayout({ id: "paste:panes", storage: localStorage })
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const writing = useUi((s) => s.view.type === "write")

  useEffect(() => {
    void startSession()
    void purgeExpiredTrash()
    void sweepNotes()
    // Ask the browser not to evict the library under storage pressure. The Storage API only exists
    // in secure contexts, so it's missing when the app is opened over plain http (e.g. a LAN IP).
    if ("storage" in navigator) void navigator.storage.persist()
  }, [])

  return (
    <DragLayer>
      <div className="flex h-dvh overflow-hidden">
        <SidebarToggle />
        <Sidebar />
        {/* Next to the sidebar the panes sit in an inset card; with it hidden they grow to fill the window. */}
        <main
          className={cn(
            "min-w-0 flex-1 transition-[padding] duration-200 ease-out motion-reduce:transition-none",
            sidebarOpen && "py-2 pr-2",
          )}
        >
          <div
            className={cn(
              "h-full overflow-hidden border bg-background transition-[border-radius,border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
              sidebarOpen ? "rounded-lg shadow-[0_1px_3px_oklch(0_0_0/0.04)] dark:shadow-none" : "border-transparent",
            )}
          >
            {writing ? (
              <WritePane />
            ) : (
              <ResizablePanelGroup id="paste:panes" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
                <ResizablePanel id="list" defaultSize="54" minSize={340}>
                  <section className="flex h-full min-w-0 flex-col">
                    <ListHeader />
                    <ClipList />
                  </section>
                </ResizablePanel>
                <ResizableHandle className="bg-border" />
                <ResizablePanel id="detail" defaultSize="46" minSize={360}>
                  <DetailPane />
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </main>
      </div>
      <QueueBar />
      <DropZone />
      <CommandPalette />
      <ShortcutsDialog />
      <ConfirmDialog />
    </DragLayer>
  )
}
