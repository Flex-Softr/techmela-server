import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const env = process.env;

/**
 * Converts duration strings (e.g., "1d", "180d", "30d", "1h", "15m") or numeric ms strings to milliseconds.
 */
const toMs = (
  duration: string | number | undefined,
  fallbackMs: number
): number => {
  if (!duration) return fallbackMs;
  if (typeof duration === "number") return duration;
  const num = Number(duration);
  if (!isNaN(num)) return num;
  const match = String(duration).match(
    /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i
  );
  if (!match) return fallbackMs;
  const val = parseFloat(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return val;
    case "s":
      return val * 1000;
    case "m":
      return val * 60 * 1000;
    case "h":
      return val * 60 * 60 * 1000;
    case "d":
      return val * 24 * 60 * 60 * 1000;
    case "w":
      return val * 7 * 24 * 60 * 60 * 1000;
    case "y":
      return val * 365 * 24 * 60 * 60 * 1000;
    default:
      return fallbackMs;
  }
};

export default {
  env: env.NODE_ENV,
  port: env.PORT,
  DBUrl: env.DB_URL,
  clientSideURL: env.CLIENT_SIDE_URL,
  main_domain: env.MAIN_DOMAIN,
  companyInfo: {
    name: env.COMPANY_NAME,
    email: env.COMPANY_EMAIL || env.SMTP_USER,
  },
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  superAdmin: {
    email: env.SEED_EMAIL || env.SEED_SUPER_ADMIN_EMAIL || env.EMAIL,
    password:
      env.SEED_PASSWORD || env.SEED_SUPER_ADMIN_PASSWORD || env.PASSWORD,
  },
  bcrypt_salt_round: env.BCRYPT_SALT_ROUND,
  token_data: {
    access_token_secret: env.ACCESS_TOKEN_SECRET,
    refresh_token_secret: env.REFRESH_TOKEN_SECRET,
    access_token_expires: env.ACCESS_TOKEN_EXPIRES,
    customer_refresh_token_expires:
      env.CUSTOMER_REFRESH_TOKEN_EXPIRES || env.REFRESH_TOKEN_EXPIRES,
    admin_staff_refresh_token_expires:
      env.ADMIN_STAFF_REFRESH_TOKEN_EXPIRES || env.REFRESH_TOKEN_EXPIRES,
    access_token_cookie_expires:
      env.ACCESS_TOKEN_COOKIE_EXPIRES ||
      toMs(env.ACCESS_TOKEN_EXPIRES, 86400000),
    customer_refresh_token_cookie_expires:
      env.CUSTOMER_REFRESH_TOKEN_COOKIE_EXPIRES ||
      toMs(
        env.CUSTOMER_REFRESH_TOKEN_EXPIRES || env.REFRESH_TOKEN_EXPIRES,
        15552000000
      ),
    admin_staff_refresh_token_cookie_expires:
      env.ADMIN_STAFF_REFRESH_TOKEN_COOKIE_EXPIRES ||
      toMs(
        env.ADMIN_STAFF_REFRESH_TOKEN_EXPIRES || env.REFRESH_TOKEN_EXPIRES,
        15552000000
      ),
  },
  session_secret: env.SESSION_SECRET || env.REFRESH_TOKEN_SECRET,
  session_expires:
    env.SESSION_EXPIRES || toMs(env.CART_ITEM_EXPIRES, 2592000000),
  cart_item_expires: env.CART_ITEM_EXPIRES,
  upload_image_size: env.UPLOAD_IMAGE_SIZE,
  upload_video_size: env.UPLOAD_VIDEO_SIZE || "20000000",
  upload_image_maxCount: env.UPLOAD_IMAGE_MAX_COUNT,
  upload_image_format: env.UPLOAD_IMAGE_FORMAT,
  upload_pdf_size: env.UPLOAD_PDF_SIZE,
  stead_fast: {
    email: env.STEADFAST_EMAIL,
    password: env.STEADFAST_PASSWORD,
  },
  pathao: {
    username: env.PATHAO_USERNAME,
    password: env.PATHAO_PASSWORD,
  },
  redx: {
    phoneNumber: env.REDX_PHONE_NUMBER,
    password: env.REDX_PASSWORD,
  },
  paperfly: {
    username: env.PAPERFLY_USERNAME,
    password: env.PAPERFLY_PASSWORD,
  },
  banglaLink: {
    base_url: env.BL_BASE_URL || "https://corpsms.banglalink.net/bl",
    user: env.BL_USER,
    pass: env.BL_PASS,
    bill_msisdn: env.BL_BILL_MSISDN,
  },
  order_tracking_url: env.ORDER_TRACKING_URL || "",
  webhook_secret: env.WEBHOOK_SECRET || env.EVENT_SECRET,
  event_secret: env.EVENT_SECRET,
  tracking_server_api_url: env.TRACKING_SERVER_API_URL,
  image_base_path: env.IMAGE_BASE_PATH || "",
  upload_platform: (env.UPLOAD_PLATFORM || "local").toLowerCase() as
    | "local"
    | "r2",
  local_upload_folder: env.LOCAL_UPLOAD_FOLDER || "uploads/public",
  r2: {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_NAME,
    publicDomain: env.R2_PUBLIC_DOMAIN || "",
  },
};
