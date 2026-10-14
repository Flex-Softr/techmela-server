import compression from "compression";
import cookieParser from "cookie-parser";
import cors, { CorsOptions } from "cors";
import express, { Application } from "express";
import userAgent from "express-useragent";
import fs from "fs";
import helmet from "helmet";
import path from "path";
import requestIp from "request-ip";
import config from "./app/config/config";
import "./app/crons";
import { ecSIDHandler } from "./app/middlewares/ecSID";
import enableCrossOriginResourcePolicy from "./app/middlewares/enableCrossOriginResourcePolicy";
import globalErrorhandler from "./app/middlewares/globalErrorHandler";
import { notFoundRoute } from "./app/middlewares/notFoundRoute";
import limitRequest from "./app/middlewares/requestLimitHandler";
import router from "./app/routes";
import { requestLogger } from "./app/utilities/logger";
import { getUploadDirectories } from "./app/utilities/mediaPath";

const app: Application = express();

const PATH_PREFIX = "server-api";

const allowedOrigins =
  config.env === "production"
    ? config.clientSideURL?.split(",") || []
    : ["http://localhost:3000", "http://localhost:3001"];

const corsOptions: CorsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "Content-Type, Authorization",
};

if (config.env === "production") {
  app.set("trust proxy", 1);
}

// Middlewares
app.use(cors(corsOptions));
app.use(
  helmet({
    contentSecurityPolicy:
      config.env === "production"
        ? {
            directives: {
              ...helmet.contentSecurityPolicy.getDefaultDirectives(),
              "frame-ancestors": ["'self'", ...allowedOrigins],
              "upgrade-insecure-requests": null,
            },
          }
        : false,
    hsts: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
// app.use(express.json({ limit: "1mb" }));
// app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(compression());
app.use(cookieParser());
app.use(userAgent.express());
app.use(requestIp.mw());

// if (config.env === "development") {
//   app.use(morgan("dev"));
// }

// Custom request logger
app.use((req, res, next) => {
  if (req.originalUrl.includes("/uploads/")) {
    return next();
  }
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    requestLogger.info(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

// handle custom session
app.use(ecSIDHandler);

// Root route
app.get(`/${PATH_PREFIX}`, (req, res) => {
  res.send(`Server is running on ${config.env} mode`);
});

// static files
const {
  publicUploadDir,
  uploadsRootDir,
  previewsDir,
  employDir,
  imageToOrderDir,
  warrantyClaimDir,
} = getUploadDirectories();

if (!fs.existsSync(publicUploadDir)) {
  fs.mkdirSync(publicUploadDir, { recursive: true });
}
if (!fs.existsSync(previewsDir)) {
  fs.mkdirSync(previewsDir, { recursive: true });
}
if (!fs.existsSync(employDir)) {
  fs.mkdirSync(employDir, { recursive: true });
}
if (!fs.existsSync(imageToOrderDir)) {
  fs.mkdirSync(imageToOrderDir, { recursive: true });
}
if (!fs.existsSync(warrantyClaimDir)) {
  fs.mkdirSync(warrantyClaimDir, { recursive: true });
}

// 1. Primary public uploads routes - serve from publicUploadDir, fallback to uploadsRootDir
app.use(
  `/${PATH_PREFIX}/uploads/public`,
  enableCrossOriginResourcePolicy,
  express.static(publicUploadDir),
  express.static(uploadsRootDir)
);
app.use(
  `/uploads/public`,
  enableCrossOriginResourcePolicy,
  express.static(publicUploadDir),
  express.static(uploadsRootDir)
);

// 2. Direct /uploads route - handles manual browser access when /public is omitted in URL
app.use(
  `/${PATH_PREFIX}/uploads`,
  enableCrossOriginResourcePolicy,
  express.static(publicUploadDir),
  express.static(uploadsRootDir)
);
app.use(
  `/uploads`,
  enableCrossOriginResourcePolicy,
  express.static(publicUploadDir),
  express.static(uploadsRootDir)
);

// 3. Previews
app.use(
  `/${PATH_PREFIX}/uploads/previews`,
  enableCrossOriginResourcePolicy,
  express.static(previewsDir)
);
app.use(
  `/uploads/previews`,
  enableCrossOriginResourcePolicy,
  express.static(previewsDir)
);

// 4. Employ profile picture
app.use(
  `/${PATH_PREFIX}/uploads/employ`,
  enableCrossOriginResourcePolicy,
  express.static(employDir)
);
app.use(
  `/uploads/employ`,
  enableCrossOriginResourcePolicy,
  express.static(employDir)
);

// 5. Image to order
app.use(
  `/${PATH_PREFIX}/uploads/image_to_order`,
  enableCrossOriginResourcePolicy,
  express.static(imageToOrderDir)
);
app.use(
  `/uploads/image_to_order`,
  enableCrossOriginResourcePolicy,
  express.static(imageToOrderDir)
);

// 6. Warranty claim request videos and images
app.use(
  `/${PATH_PREFIX}/uploads/warranty_claim`,
  enableCrossOriginResourcePolicy,
  express.static(warrantyClaimDir)
);
app.use(
  `/uploads/warranty_claim`,
  enableCrossOriginResourcePolicy,
  express.static(warrantyClaimDir)
);

//Global rate limiter
app.use(`/${PATH_PREFIX}/v1`, limitRequest(15, 1000));

// api endpoints
app.use(`/${PATH_PREFIX}/v1`, router);

// Global error handler
app.use(globalErrorhandler);

// handle not found route
app.use(notFoundRoute);

export default app;
