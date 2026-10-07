import type { LucideIcon } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface Option<T extends string> {
  value: T
  label: string
  icon: LucideIcon
}

/** The one compact switch used across the app (list/grid, preview/edit). `iconOnly` moves labels into tooltips. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  iconOnly,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
  iconOnly?: boolean
  label: string
}) {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value}
      // Radix reports "" when the active item is clicked again; a segmented control always has a value.
      onValueChange={(next) => next && onChange(next as T)}
      spacing={0.5}
      className="h-7 rounded-md bg-muted p-0.5 dark:bg-accent/60"
    >
      {options.map((option) => {
        const item = (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-label={option.label}
            className={cn(
              "h-6 min-w-6 gap-1.5 rounded-[5px] px-2 text-caption font-normal text-muted-foreground transition-[color,background-color,box-shadow] duration-150",
              "hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs dark:data-[state=on]:bg-white/10",
              "[&_svg:not([class*='size-'])]:size-3.5",
              iconOnly && "w-7 px-0",
            )}
          >
            <option.icon />
            {!iconOnly && option.label}
          </ToggleGroupItem>
        )
        if (!iconOnly) return item
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger asChild>{item}</TooltipTrigger>
            <TooltipContent>{option.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </ToggleGroup>
  )
}
