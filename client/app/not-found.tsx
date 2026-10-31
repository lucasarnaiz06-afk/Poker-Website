import type { Metadata } from "next";
import { NotFoundState } from "@/components/shell/route-states";

export const metadata: Metadata = { title: "Page not found" };

export default function RootNotFound() {
  return <NotFoundState />;
}
