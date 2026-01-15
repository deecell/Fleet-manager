import express, { type Express } from "express";
import session from "express-session";
import fleetRoutes from "../server/api/fleet-routes";

export function createTestApp(): Express {
  const app = express();
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  
  app.use(session({
    secret: "test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));
  
  app.use("/api/v1", fleetRoutes);
  
  return app;
}
