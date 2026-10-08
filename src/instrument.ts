import { config } from "dotenv";
import { initSentry } from "./config/sentry.js";

// Preloaded with `node --import` (see the start and dev scripts and the Dockerfile) so Sentry is set up before Express
// and http are loaded: ESM links every static import of index.ts before running any of it, so initialising Sentry
// from there is too late for it to hook into them.
config();
initSentry();
