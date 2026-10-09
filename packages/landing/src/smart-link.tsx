import * as React from "react";
import Link from "next/link";

const ABSOLUTE = /^(https?:)?\/\//i;

interface SmartLinkProps {
  href: string;
  className?: string | undefined;
  children: React.ReactNode;
  "aria-label"?: string | undefined;
}

/**
 * A link that works for both apps. Paths inside the current app use the router;
 * absolute URLs (the other app, for example) are plain anchors that open normally.
 */
export function SmartLink({ href, className, children, "aria-label": ariaLabel }: SmartLinkProps) {
  if (ABSOLUTE.test(href)) {
    return (
      <a href={href} className={className} aria-label={ariaLabel}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
