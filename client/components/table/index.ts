// Public surface of the table UI. Integration (after the server speaks table-view.ts):
//   <LiveTableProvider tableId={id}><TableScreen /></LiveTableProvider>
export { TableScreen } from "./table-screen";
export { LiveTableProvider, TableProvider, useTableController } from "./table-context";
export { MockTableProvider } from "./mock-provider";
export { useTable, type UseTableOptions } from "./use-table";
export type { ConnectionStatus, TableCommands, TableController, TableNotice } from "./table-controller";
export { PlayingCard } from "./playing-card";
