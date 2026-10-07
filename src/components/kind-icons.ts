import { AudioLines, Braces, CodeXml, File, FileText, Film, Image, Link2, type LucideIcon, Palette, Pilcrow, Type } from "lucide-react"
import type { Clip } from "@/db/schema"

export const KIND_ICON: Record<Clip["kind"], LucideIcon> = {
  text: Type,
  markdown: Pilcrow,
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
