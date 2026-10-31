/** Error with a stable machine-readable code; the socket layer turns it into `{ ok: false, code, message }`. */
export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function fail(code: string, message: string): never {
  throw new RuntimeError(code, message);
}
