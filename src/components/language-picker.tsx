import { Check, ChevronDown } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { type LanguageOption, loadLanguages } from "@/lib/code"
import { cn } from "@/lib/utils"

/** Picks a code language from everything Shiki can highlight; the list loads when it first opens. */
export function LanguagePicker({
  language,
  onSelect,
  className,
}: {
  language: string | null | undefined
  onSelect: (id: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [languages, setLanguages] = useState<LanguageOption[]>([])

  useEffect(() => {
    if (open && !languages.length) void loadLanguages().then(setLanguages)
  }, [open, languages.length])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className={cn("font-mono text-caption text-muted-foreground", className)}>
          {language || "plain"}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Language…" />
          <CommandList>
            <CommandEmpty>No language</CommandEmpty>
            <CommandGroup>
              {languages.map((lang) => (
                <CommandItem
                  key={lang.id}
                  value={`${lang.name} ${lang.id}`}
                  onSelect={() => {
                    onSelect(lang.id)
                    setOpen(false)
                  }}
                >
                  {lang.name}
                  {lang.id === language && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
