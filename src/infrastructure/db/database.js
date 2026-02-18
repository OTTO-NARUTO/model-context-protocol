// Temporary in-memory storage intended for testing flows.
export class Database {
  constructor() {
    this.oauthStates = new Map();
    this.tokens = new Map();
  }

  async initialize() {
    return;
  }

  async saveOAuthState(record) {
    this.oauthStates.set(record.state, record);
  }

  async getOAuthState(state) {
    return this.oauthStates.get(state) ?? null;
  }

  async deleteOAuthState(state) {
    this.oauthStates.delete(state);
  }

  async upsertToken(token) {
    this.tokens.set(this.key(token.tenantId, token.provider), token);
  }

  async getToken(tenantId, provider) {
    return this.tokens.get(this.key(tenantId, provider)) ?? null;
  }

  async deleteToken(tenantId, provider) {
    this.tokens.delete(this.key(tenantId, provider));
  }

  key(tenantId, provider) {
    return `${tenantId}::${provider}`;
  }
}
