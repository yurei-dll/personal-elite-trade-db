export interface EddnListener {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createEddnListener(): EddnListener {
  return {
    async start(): Promise<void> {
      throw new Error("EDDN listener startup is not implemented yet.");
    },
    async stop(): Promise<void> {
      throw new Error("EDDN listener shutdown is not implemented yet.");
    },
  };
}
