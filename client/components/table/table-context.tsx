"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TableController } from "./table-controller";
import { useTable, type UseTableOptions } from "./use-table";

const TableContext = createContext<TableController | null>(null);

export function TableProvider({ controller, children }: { controller: TableController; children: ReactNode }) {
  return <TableContext.Provider value={controller}>{children}</TableContext.Provider>;
}

/** Live socket-backed provider: `<LiveTableProvider tableId="…"><TableScreen /></LiveTableProvider>`. */
export function LiveTableProvider({
  tableId,
  children,
  ...options
}: UseTableOptions & { tableId: string; children: ReactNode }) {
  const controller = useTable(tableId, options);
  return <TableProvider controller={controller}>{children}</TableProvider>;
}

export function useTableController(): TableController {
  const value = useContext(TableContext);
  if (!value) throw new Error("useTableController must be used inside <TableProvider>");
  return value;
}
