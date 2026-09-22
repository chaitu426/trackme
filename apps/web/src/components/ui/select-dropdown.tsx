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
          bg-white transition duration-150 ease-in-out cursor-pointer
          ${isDisabled ? "cursor-not-allowed opacity-50 border-zinc-200 bg-zinc-50" : "hover:border-zinc-300 hover:bg-zinc-50/50"}
          ${isOpen ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200/90 shadow-xs"}
        `}
      >
        <span className={selectedOption ? "text-zinc-900" : "text-zinc-400"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
            isOpen ? "transform rotate-180 text-zinc-900" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-60 overflow-auto rounded-xl bg-white border border-zinc-200/90 p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
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
                  ${isSelected ? "bg-zinc-100 text-zinc-900 font-semibold" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"}
                `}
              >
                <div>
                  <div>{option.label}</div>
                  {option.description && (
                    <div className="text-[10px] text-zinc-400 font-normal mt-0.5">{option.description}</div>
                  )}
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-zinc-900 shrink-0 ml-2" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
