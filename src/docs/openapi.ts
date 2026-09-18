import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry.js";
import "./health.docs.js";
import "./user.docs.js";
import "./driverProfile.docs.js";
import "./riderProfile.docs.js";
import "./vehicle.docs.js";
import "./role.docs.js";
import "./adminUser.docs.js";
import "./auth.docs.js";

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Nframa API",
    version: "1.0.0",
  },
});
