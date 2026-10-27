// Types of cert.mjs for the server unit tests (TEST ONLY).
export declare function generateSelfSignedCert(days?: number): { cert: string; key: string };
export declare function loadOrCreateCert(dir: string): {
  cert: string;
  key: string;
  certPath: string;
};
