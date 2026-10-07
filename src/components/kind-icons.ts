import {
  AudioLines,
  Braces,
  CodeXml,
  File,
  FileText,
  Film,
  Heading,
  Image,
  Link2,
  NotebookPen,
  type LucideIcon,
  Palette,
  TextAlignStart,
} from "lucide-react"
import type { Clip } from "@/db/schema"

export const KIND_ICON: Record<Clip["kind"], LucideIcon> = {
  note: NotebookPen,
  text: TextAlignStart,
  markdown: Heading,
  code: CodeXml,
  json: Braces,
  link: Link2,
  color: Palette,
  image: Image,
  video: Film,
  audio: AudioLines,
  pdf: FileText,
  file: File,
}
