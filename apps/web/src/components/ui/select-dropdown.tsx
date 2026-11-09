"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { MenuPanel } from "@/components/ui/menu-panel";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string | undefined;
}

export interface SelectDropdownProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[] | SelectOption<T>[];
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  ariaLabel?: string | undefined;
}

/**
 * A select whose options can carry a description. Same height, radius and focus as a text input. Keyboard: Enter, Space or the
 * arrows open it; arrows move; Enter picks; Escape closes and returns focus to the button. A click outside closes it.
 */
export function SelectDropdown<T extends string | number>({ value, onChange, options, disabled = false, placeholder = "Select", className = "", ariaLabel }: SelectDropdownProps<T>) {
  const [open, setOpen] = React.useState(false);
  const wrapper = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const isDisabled = Boolean(disabled);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    // Focus the chosen option (or the first) so the arrows work straight away.
    requestAnimationFrame(() => {
      const items = list.current?.querySelectorAll<HTMLElement>('[role="option"]');
      (items && ([...items].find((el) => el.getAttribute("aria-selected") === "true") ?? items[0]))?.focus();
    });
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onListKey(e: React.KeyboardEvent) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[Math.min(items.length - 1, at + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[Math.max(0, at - 1)]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapper} className={cn("relative inline-block w-full", className)}>
      <button
        ref={trigger}
        type="button"
        disabled={isDisabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "press flex h-10 w-full items-center justify-between gap-3 rounded-lg border bg-white/[0.03] px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          isDisabled ? "cursor-not-allowed opacity-50" : "hover:border-white/[0.14]",
          open ? "border-white/[0.28] bg-white/[0.05]" : "border-border"
        )}
      >
        <span className={cn("truncate", selected ? "text-zinc-100" : "text-zinc-600")}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-zinc-500 transition-transform duration-200", open && "rotate-180 text-zinc-200")} aria-hidden="true" />
      </button>

      <MenuPanel open={open} role="listbox" className="left-0 right-0 top-full mt-2 max-h-60 overflow-auto p-1">
        <div ref={list} onKeyDown={onListKey}>
          {options.map((option) => {
            const on = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:bg-white/[0.08]",
                  on ? "bg-white/[0.08] text-zinc-50" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-50"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.description && <span className="mt-0.5 block text-xs font-normal text-zinc-500">{option.description}</span>}
                </span>
                {on && <Check className="size-4 shrink-0 text-zinc-100" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </MenuPanel>
    </div>
  );
}
