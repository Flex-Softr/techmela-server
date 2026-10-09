import config from "../config/config";

/**
 * Returns the configured base URL for media files without trailing slashes.
 * Supports hybrid platforms: "local" and "r2".
 */
export const getImageBasePath = (): string => {
  const envBasePath = config.image_base_path?.trim().replace(/\/+$/, "") || "";
  const isPlaceholder =
    !envBasePath ||
    envBasePath === "your_custom_domain_or_r2_dev_url" ||
    envBasePath.includes("your_custom_domain_or_r2_dev_url");

  if (config.upload_platform === "local") {
    if (!isPlaceholder && !envBasePath.includes("r2.dev")) {
      return envBasePath;
    }
    const port = config.port || 5000;
    return `http://localhost:${port}/server-api/uploads/public`;
  }

  // R2 platform
  if (isPlaceholder) {
    const r2Public = config.r2?.publicDomain?.trim().replace(/\/+$/, "") || "";
    if (r2Public && !r2Public.includes("your_custom_domain_or_r2_dev_url")) {
      return r2Public;
    }
    return "";
  }

  return envBasePath;
};

/**
 * Normalizes and extracts only the relative storage key/path from a full URL or path string.
 * This ensures that only the key (e.g. "products/123/img.webp") is saved in the database.
 *
 * Examples:
 * - "http://localhost:5000/server-api/uploads/public/products/123/img.webp" -> "products/123/img.webp"
 * - "https://cdn.example.com/products/123/img.webp" -> "products/123/img.webp"
 * - "/products/123/img.webp" -> "products/123/img.webp"
 * - "products/123/img.webp" -> "products/123/img.webp"
 */
export const extractMediaKey = (
  urlOrPath: string | undefined | null
): string => {
  if (!urlOrPath || typeof urlOrPath !== "string") {
    return "";
  }
  const trimmed = urlOrPath.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") {
    return "";
  }

  let clean = trimmed;

  // Handle absolute HTTP/HTTPS URLs
  if (/^https?:\/\//i.test(clean)) {
    try {
      const parsed = new URL(clean);
      clean = parsed.pathname;
    } catch {
      clean = clean.replace(/^https?:\/\/[^/]+\/?/i, "");
    }
  }

  // Strip leading and trailing slashes
  clean = clean.replace(/^\/+/, "").replace(/\/+$/, "");

  // Strip local static endpoint prefixes if present
  clean = clean.replace(/^server-api\/uploads\/public\//i, "");
  clean = clean.replace(/^uploads\/public\//i, "");
  clean = clean.replace(/^server-api\/uploads\/previews\//i, "");
  clean = clean.replace(/^uploads\/previews\//i, "");
  clean = clean.replace(/^server-api\/uploads\//i, "");
  clean = clean.replace(/^uploads\//i, "");

  return clean;
};

/**
 * Merges the configured image base path before the relative storage key.
 * If the input already contains a full URL, its pathname is extracted and prefixed
 * with the current image base path dynamically.
 *
 * Examples:
 * - "products/123/img.webp" -> "http://localhost:5000/server-api/uploads/public/products/123/img.webp"
 * - "/products/123/img.webp" -> "http://localhost:5000/server-api/uploads/public/products/123/img.webp"
 */
export const mergeMediaBaseUrl = (
  keyOrUrl: string | undefined | null
): string => {
  if (!keyOrUrl || typeof keyOrUrl !== "string") {
    return "";
  }
  const trimmed = keyOrUrl.trim();
  if (
    !trimmed ||
    trimmed === "null" ||
    trimmed === "undefined" ||
    trimmed.startsWith("data:")
  ) {
    return "";
  }

  const basePath = getImageBasePath();
  if (!basePath) {
    return trimmed;
  }

  // If already starts with the current configured basePath, return as is (idempotent)
  if (trimmed.startsWith(basePath)) {
    return trimmed;
  }

  const cleanKey = extractMediaKey(trimmed);
  if (!cleanKey) {
    return trimmed;
  }

  return `${basePath}/${cleanKey}`;
};

/**
 * Recursively inspects and transforms media paths (`src`, `url`, etc.) on response payloads,
 * merging the image base path before each relative key.
 */
export const attachMediaBaseUrls = <T>(data: T): T => {
  if (!data || typeof data !== "object") {
    return data;
  }

  const seen = new WeakSet<object>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transform = (item: any, depth = 0): any => {
    if (depth > 20 || !item || typeof item !== "object") {
      return item;
    }

    // Skip special non-plain objects
    if (
      item instanceof Date ||
      item instanceof RegExp ||
      (item.constructor && item.constructor.name === "ObjectId") ||
      item._bsontype === "ObjectID" ||
      item._bsontype === "ObjectId" ||
      Buffer.isBuffer(item)
    ) {
      return item;
    }

    // Convert Mongoose Document to plain object if possible
    if (typeof item.toObject === "function") {
      item = item.toObject();
    } else if (item._doc && typeof item._doc === "object") {
      item = item._doc;
    }

    if (seen.has(item)) {
      return item;
    }
    seen.add(item);

    if (Array.isArray(item)) {
      return item.map((element) => transform(element, depth + 1));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const key of Object.keys(item)) {
      const val = item[key];
      if (
        (key === "src" || key === "url" || key === "thumb" || key === "path") &&
        typeof val === "string"
      ) {
        result[key] = mergeMediaBaseUrl(val);
      } else if (key === "thumbnail" && typeof val === "string") {
        result[key] = mergeMediaBaseUrl(val);
      } else if (
        key === "gallery" &&
        Array.isArray(val) &&
        val.length > 0 &&
        typeof val[0] === "string"
      ) {
        result[key] = val.map((v) =>
          typeof v === "string" ? mergeMediaBaseUrl(v) : transform(v, depth + 1)
        );
      } else if (typeof val === "object" && val !== null) {
        result[key] = transform(val, depth + 1);
      } else {
        result[key] = val;
      }
    }

    return result;
  };

  return transform(data);
};
