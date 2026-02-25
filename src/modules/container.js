import { env } from "../config/env.js";
import { OAuthService } from "../application/services/oauthService.js";
import { Database } from "../infrastructure/db/database.js";
import { EncryptionUtil } from "../infrastructure/security/encryptionUtil.js";
import { McpClient } from "../infrastructure/clients/mcpClient.js";
import { RestToolFallbackClient } from "../infrastructure/clients/restToolFallbackClient.js";
import { ToolResolver } from "../application/services/toolResolver.js";
import { ToolExecutionStrategy } from "../application/services/toolExecutionStrategy.js";
import { AuthController } from "../presentation/controllers/authController.js";
import { ComplianceController } from "../presentation/controllers/complianceController.js";

export async function buildContainer() {
  const db = new Database();
  await db.initialize();

  const encryption = new EncryptionUtil(env.ENCRYPTION_KEY);
  const oauthService = new OAuthService(db, encryption);
  const mcpClient = new McpClient();
  const restClient = new RestToolFallbackClient();
  const toolResolver = new ToolResolver();
  const toolExecutionStrategy = new ToolExecutionStrategy(mcpClient, restClient, toolResolver);

  return {
    db,
    authController: new AuthController(oauthService),
    complianceController: new ComplianceController(oauthService, toolExecutionStrategy)
  };
}
