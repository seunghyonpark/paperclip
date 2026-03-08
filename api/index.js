import {
  createDb,
  inspectMigrations,
  applyPendingMigrations,
  reconcilePendingMigrationHistory,
} from "../packages/db/dist/index.js";
import { createApp } from "../server/dist/app.js";
import {
  createBetterAuthHandler,
  createBetterAuthInstance,
  deriveAuthTrustedOrigins,
  resolveBetterAuthSession,
} from "../server/dist/auth/better-auth.js";
import { initializeBoardClaimChallenge } from "../server/dist/board-claim.js";
import { loadConfig } from "../server/dist/config.js";
import { createStorageServiceFromConfig } from "../server/dist/storage/index.js";

let appPromise = null;

async function ensureDatabaseMigrations(connectionString) {
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

async function createRequestHandler() {
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
  const auth = createBetterAuthInstance(db, config, effectiveTrustedOrigins);
  const betterAuthHandler = createBetterAuthHandler(auth);
  const resolveSession = (req) => resolveBetterAuthSession(auth, req);

  await initializeBoardClaimChallenge(db, {
    deploymentMode: config.deploymentMode,
  });

  return createApp(db, {
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
}

async function getRequestHandler() {
  if (!appPromise) {
    appPromise = createRequestHandler();
  }
  return appPromise;
}

export default async function handler(req, res) {
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
