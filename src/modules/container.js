import { env } from "../config/env.js";
import { OAuthService } from "../application/services/oauthService.js";
import { Database } from "../infrastructure/db/database.js";
import { EncryptionUtil } from "../infrastructure/security/encryptionUtil.js";
import { McpClient } from "../infrastructure/clients/mcpClient.js";
import { AuthController } from "../presentation/controllers/authController.js";
import { ComplianceController } from "../presentation/controllers/complianceController.js";

export async function buildContainer() {
  const db = new Database();
  await db.initialize();

  const encryption = new EncryptionUtil(env.ENCRYPTION_KEY);
  const oauthService = new OAuthService(db, encryption);
  const mcpClient = new McpClient();

  return {
    db,
    authController: new AuthController(oauthService),
    complianceController: new ComplianceController(oauthService, mcpClient)
  };
}
