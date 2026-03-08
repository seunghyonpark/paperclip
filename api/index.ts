import type { Request as ExpressRequest, RequestHandler } from "express";
import {
  createDb,
  inspectMigrations,
  applyPendingMigrations,
  reconcilePendingMigrationHistory,
} from "../packages/db/src/index.ts";
import { createApp } from "../server/src/app.ts";
import { createBetterAuthHandler, createBetterAuthInstance, deriveAuthTrustedOrigins, resolveBetterAuthSession } from "../server/src/auth/better-auth.ts";
import { initializeBoardClaimChallenge } from "../server/src/board-claim.ts";
import { loadConfig } from "../server/src/config.ts";
import { createStorageServiceFromConfig } from "../server/src/storage/index.ts";

let appPromise: Promise<RequestHandler> | null = null;

async function ensureDatabaseMigrations(connectionString: string) {
  let state = await inspectMigrations(connectionString);
  if (state.status === "needsMigrations" && state.reason === "pending-migrations") {
    const repair = await reconcilePendingMigrationHistory(connectionString);
    if (repair.repairedMigrations.length > 0) {
      state = await inspectMigrations(connectionString);
    }
  }

  if (state.status === "upToDate" || process.env.PAPERCLIP_VERCEL_AUTO_MIGRATE === "false") {
    return;
  }

  await applyPendingMigrations(connectionString);
}

async function createRequestHandler(): Promise<RequestHandler> {
  const config = loadConfig();

  if (!config.databaseUrl) {
    throw new Error("Vercel deployment requires DATABASE_URL to be set.");
  }

  if (config.deploymentMode === "local_trusted") {
    throw new Error(
      "Vercel deployment requires PAPERCLIP_DEPLOYMENT_MODE=authenticated.",
    );
  }

  await ensureDatabaseMigrations(config.databaseUrl);

  const db = createDb(config.databaseUrl);
  const betterAuthSecret =
    process.env.BETTER_AUTH_SECRET?.trim() ?? process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim();
  if (!betterAuthSecret) {
    throw new Error(
      "Vercel deployment requires BETTER_AUTH_SECRET (or PAPERCLIP_AGENT_JWT_SECRET).",
    );
  }

  const trustedOrigins = deriveAuthTrustedOrigins(config);
  const envTrustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const effectiveTrustedOrigins = Array.from(new Set([...trustedOrigins, ...envTrustedOrigins]));
  const auth = createBetterAuthInstance(db as never, config, effectiveTrustedOrigins);
  const betterAuthHandler = createBetterAuthHandler(auth);
  const resolveSession = (req: ExpressRequest) => resolveBetterAuthSession(auth, req);

  await initializeBoardClaimChallenge(db as never, {
    deploymentMode: config.deploymentMode,
  });

  const app = await createApp(db as never, {
    uiMode: "none",
    storageService: createStorageServiceFromConfig(config),
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    allowedHostnames: config.allowedHostnames,
    bindHost: config.host,
    authReady: true,
    companyDeletionEnabled: config.companyDeletionEnabled,
    betterAuthHandler,
    resolveSession,
  });

  return app as unknown as RequestHandler;
}

async function getRequestHandler() {
  if (!appPromise) {
    appPromise = createRequestHandler();
  }
  return appPromise;
}

export default async function handler(req: ExpressRequest, res: Parameters<RequestHandler>[1]) {
  try {
    const app = await getRequestHandler();
    return app(req, res, () => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paperclip failed to initialize";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
      return;
    }
    throw error;
  }
}
