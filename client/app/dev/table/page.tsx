import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TablePlayground } from "./playground";

export const metadata: Metadata = { title: "Table playground" };

export default function DevTablePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TablePlayground />;
}
