/** An expected, client-visible failure. `message` is a stable machine-readable code. */
export class AppError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(statusCode: number, code: string, details?: unknown) {
    super(code);
    this.statusCode = statusCode;
    this.details = details;
  }
}
