// Types of list.mjs for the server unit tests (TEST ONLY).
export declare const TEST_ICONS: Readonly<Record<string, string>>;
/** Connector entries (schemaVersion 1) of the test partners on `origin`. */
export declare function partnerEntries(origin: string): unknown[];
export declare function createListKeys(): { privateKey: unknown; publicKeyBase64: string };
export declare function buildSignedList(options: {
  origin: string;
  privateKey: unknown;
  sequence?: number;
  generatedAt?: Date;
}): { bytes: Buffer; signature: string };
