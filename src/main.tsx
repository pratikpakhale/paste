import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"
import { Root } from "./root"
import "./index.css"

registerSW({ immediate: true })

createRoot(document.getElementById("root")!).render(<Root />)
