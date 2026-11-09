import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <span className="enter grid size-12 place-items-center rounded-xl border border-border bg-white/[0.03] text-zinc-400">
        <Compass className="size-6" aria-hidden="true" />
      </span>
      <h1 className="enter mt-6 text-[28px] font-medium leading-9 text-zinc-50" style={{ ["--i" as string]: 1 }}>
        Page not found
      </h1>
      <p className="enter mt-2 max-w-sm text-sm leading-5 text-zinc-400" style={{ ["--i" as string]: 2 }}>
        The page does not exist, or you do not have access to it.
      </p>
      <Link href="/" className={cn(buttonBase, buttonVariants.primary, buttonSizes.md, "enter mt-6")} style={{ ["--i" as string]: 3 }}>
        Back to dashboard
      </Link>
    </div>
  );
}
