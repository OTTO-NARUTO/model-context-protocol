import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  FRONTEND_BASE_URL: z.string().url(),
  ENCRYPTION_KEY: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  GITHUB_REDIRECT_URI: z.string().url().optional().default("http://localhost:8080/api/auth/github/callback"),
  GITLAB_CLIENT_ID: z.string().optional().default(""),
  GITLAB_CLIENT_SECRET: z.string().optional().default(""),
  GITLAB_REDIRECT_URI: z.string().url().optional().default("http://localhost:8080/api/auth/gitlab/callback"),
  BITBUCKET_CLIENT_ID: z.string().optional().default(""),
  BITBUCKET_CLIENT_SECRET: z.string().optional().default(""),
  BITBUCKET_REDIRECT_URI: z.string().url().optional().default("http://localhost:8080/api/auth/bitbucket/callback"),
  GITHUB_MCP_URL: z.string().url().or(z.literal("")).default(""),
  GITLAB_MCP_URL: z.string().url().or(z.literal("")).default(""),
  BITBUCKET_MCP_URL: z.string().url().or(z.literal("")).default("")
});

export const env = envSchema.parse(process.env);
