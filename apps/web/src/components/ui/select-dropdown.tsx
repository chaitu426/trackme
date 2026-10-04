"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";

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

export function SelectDropdown<T extends string | number>({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Select option...",
  className = "",
  ariaLabel,
}: SelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const isDisabled = Boolean(disabled);

  const selectedOption = options.find((opt) => opt.value === value);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className={`relative inline-block w-full ${className}`}>
      <button
        type="button"
        disabled={isDisabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-medium
          bg-white/[0.02] transition duration-150 ease-in-out cursor-pointer
          ${isDisabled ? "cursor-not-allowed opacity-50 border-white/10 bg-white/[0.03]" : "hover:border-white/20 hover:bg-white/[0.03]"}
          ${isOpen ? "border-white/20 ring-2 ring-blue-500/20" : "border-white/10"}
        `}
      >
        <span className={selectedOption ? "text-zinc-50" : "text-zinc-400"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
            isOpen ? "transform rotate-180 text-zinc-50" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-auto rounded-xl border border-white/10 bg-zinc-950 p-1 shadow-float"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`
                  w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition cursor-pointer text-left
                  ${isSelected ? "bg-white/[0.08] text-zinc-50 font-semibold" : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-50"}
                `}
              >
                <div>
                  <div>{option.label}</div>
                  {option.description && (
                    <div className="text-[10px] text-zinc-400 font-normal mt-0.5">{option.description}</div>
                  )}
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-zinc-50 shrink-0 ml-2" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
