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
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "frame-ancestors": ["'self'", ...allowedOrigins],
      },
    },
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
  if (req.originalUrl.startsWith(`/${PATH_PREFIX}/uploads`)) {
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
const uploadsPath = path.join(
  process.cwd(),
  config.local_upload_folder || "uploads/public"
);
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use(
  `/${PATH_PREFIX}/uploads/public`,
  enableCrossOriginResourcePolicy,
  express.static(uploadsPath)
);
app.use(
  `/uploads/public`,
  enableCrossOriginResourcePolicy,
  express.static(uploadsPath)
);

const previewsPath = path.join(__dirname, "..", "uploads/previews");
app.use(
  `/${PATH_PREFIX}/uploads/previews`,
  enableCrossOriginResourcePolicy,
  express.static(previewsPath)
);

const employProfilePicture = path.join(__dirname, "..", "uploads/employ");
app.use(
  `/${PATH_PREFIX}/uploads/employ`,
  enableCrossOriginResourcePolicy,
  express.static(employProfilePicture)
);

const imageToOrder = path.join(__dirname, "..", "uploads/image_to_order");
app.use(
  `/${PATH_PREFIX}/uploads/image_to_order`,
  enableCrossOriginResourcePolicy,
  express.static(imageToOrder)
);

// Warranty claim request videos and images
const warrantyclaimVideosImages = path.join(
  __dirname,
  "..",
  "uploads/warranty_claim"
);
app.use(
  `/${PATH_PREFIX}/uploads/warranty_claim`,
  enableCrossOriginResourcePolicy,
  express.static(warrantyclaimVideosImages)
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
