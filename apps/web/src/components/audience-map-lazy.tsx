"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * react-simple-maps plus the world topojson is the heaviest thing on the dashboard
 * and needs the browser anyway, so it loads as its own chunk after the page is
 * interactive. The placeholder keeps the card's height so nothing jumps.
 */
export const AudienceMap = dynamic(() => import("./audience-map").then((m) => m.AudienceMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full rounded-lg" />,
});
