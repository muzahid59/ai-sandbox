export type GoogleConnectionStatus =
  | {
      connected: true;
      email: string;
      scopes: string[];
      connectedAt: string;
    }
  | {
      connected: false;
      authorizeUrl: string;
    };

export interface TokenRecord {
  accessToken: string;
  refreshToken: string;
  expiryTimestamp: Date;
  scopes: string[];
  googleEmail: string;
}
