import { redirect } from "next/navigation";

// The docs origin is for documentation only; there is no marketing landing here.
export default function HomePage() {
  redirect("/docs");
}
