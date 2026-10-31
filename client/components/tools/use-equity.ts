"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EquityRequest, EquityResponse } from "./equity-protocol";

type Pending = { resolve: (r: EquityResponse) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EquityJob = DistributiveOmit<EquityRequest, "id">;

/**
 * Equity calculations in a Web Worker. `run` resolves with the response; `cancel` terminates the running job
 * (the worker is restarted on the next run), so a stale calculation never blocks a new one.
 */
export function useEquityWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(new URL("./equity.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<EquityResponse>) => {
        const job = pending.current.get(event.data.id);
        if (job) {
          pending.current.delete(event.data.id);
          job.resolve(event.data);
        }
      };
      worker.onerror = () => {
        for (const [id, job] of pending.current) job.resolve({ id, ok: false, error: "The calculator crashed. Try again." });
        pending.current.clear();
        workerRef.current?.terminate();
        workerRef.current = null;
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const cancel = useCallback(() => {
    if (pending.current.size === 0) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    for (const [id, job] of pending.current) job.resolve({ id, ok: false, error: "cancelled" });
    pending.current.clear();
  }, []);

  const run = useCallback(
    (job: EquityJob) =>
      new Promise<EquityResponse>((resolve) => {
        const id = nextId.current++;
        pending.current.set(id, { resolve });
        getWorker().postMessage({ ...job, id } as EquityRequest);
      }),
    [getWorker],
  );

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { run, cancel };
}
