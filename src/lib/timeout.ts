/**
 * Races a promise against a timeout so one slow/unreachable host (e.g. a TCP connect() that
 * hangs instead of erroring, common with a firewalled or dead IP) can never block an
 * aggregated view — like the fleet-wide Docker or monitoring pages — indefinitely.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "Délai dépassé."): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
