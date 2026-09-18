import { Router } from "express";
import { getHealth, getRoot } from "../controllers/health.controller.js";

export const healthRouter = Router();

healthRouter.get("/health", getHealth);
healthRouter.get("/", getRoot);
