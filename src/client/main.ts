declare global {
  interface Window {
    __config: {
      defaultTokens: Record<string, { from: string; to: string }>;
      walletConnectProjectId: string;
    };
  }
}

console.log("[client] bundle loaded");
export {};
