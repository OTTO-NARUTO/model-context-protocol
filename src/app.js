import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { buildAuthRoutes } from "./presentation/routes/authRoutes.js";
import { buildComplianceRoutes } from "./presentation/routes/complianceRoutes.js";
import { errorMiddleware } from "./presentation/middleware/errorMiddleware.js";
import { tenantMiddleware } from "./presentation/middleware/tenantMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildApp(container) {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        fontSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(cors());
  app.use(morgan("combined"));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", tenantMiddleware);
  app.use("/api/auth", buildAuthRoutes(container.authController));
  app.use("/api/compliance", buildComplianceRoutes(container.complianceController));

  const publicPath = path.resolve(__dirname, "../public");
  app.use(
    express.static(publicPath, {
      etag: false,
      lastModified: false,
      maxAge: 0,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    })
  );

  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  app.get("/dashboard/:provider", (_req, res) => {
    res.sendFile(path.join(publicPath, "dashboard.html"));
  });

  app.use(errorMiddleware);
  return app;
}
