import type {
  ConnectorConnectionView,
  ConnectorEntry,
  ConnectorGallery,
  ConnectorListStatus,
} from '@ezychat/shared';

/**
 * What the connector list module offers the rest of the server (ctx.services.connectorList).
 * `entry(id)` is the current list entry this app may run (`fit` ok), else null.
 */
export interface ConnectorListService {
  status(): ConnectorListStatus;
  entry(id: string): ConnectorEntry | null;
  /** The gallery for Admin → Connectors (list entries + saved connections, delisted flagged). */
  gallery(): ConnectorGallery;
  /** Downloads and checks the list now (deduplicated, rate-limited); resolves with the gallery. */
  refresh(): Promise<ConnectorGallery>;
  shutdown(): void;
}

/**
 * What the partner (MCP) connections module tells the list module (ctx.services.connectorConnections),
 * so the gallery can show each connection and keep connectors that left the list.
 */
export interface ConnectorConnectionsPort {
  /** The connection of a list connector, or null when it was never connected. */
  view(id: string): ConnectorConnectionView | null;
  /** Every saved connection with the entry copy saved when it was connected. */
  saved(): Array<{ id: string; entry: ConnectorEntry }>;
}

declare module '../../context.js' {
  interface Services {
    connectorList?: ConnectorListService;
    connectorConnections?: ConnectorConnectionsPort;
  }
}
