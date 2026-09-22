"use client";

import * as React from "react";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className = "",
  "aria-label": ariaLabel,
}: SwitchProps) {
  const isDisabled = Boolean(disabled);

  const handleClick = () => {
    if (!isDisabled) {
      onCheckedChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isDisabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCheckedChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      id={id}
      disabled={isDisabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
        transition-colors duration-200 ease-in-out focus-visible:outline-none 
        focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2
        ${isDisabled ? "cursor-not-allowed opacity-40" : ""}
        ${checked ? "bg-zinc-900" : "bg-zinc-200"}
        ${className}
      `}
    >
      <span
        aria-hidden="true"
        className={`
          pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs
          transform transition duration-200 ease-in-out
          ${checked ? "translate-x-[18px]" : "translate-x-1"}
        `}
      />
    </button>
  );
}
