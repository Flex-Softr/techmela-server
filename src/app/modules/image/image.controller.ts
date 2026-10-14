import fs from "fs";
import httpStatus from "http-status";
import path from "path";
import sharp from "sharp";
import ApiError from "../../errorHandlers/ApiError";
import catchAsync from "../../utilities/catchAsync";
import successResponse from "../../utilities/successResponse";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import config from "../../config/config";
import { r2Client } from "../../config/r2.config";
import { ImageServices } from "./image.service";

import {
  extractMediaKey,
  getUploadDirectories,
  mergeMediaBaseUrl,
} from "../../utilities/mediaPath";

const generatePresignedUrl = catchAsync(async (req, res) => {
  const { filename, contentType, purpose, refId } = req.body;
  if (!filename || !contentType) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Filename and contentType are required"
    );
  }

  // Create an SEO-friendly unique key for the file
  const timestamp = Date.now();
  const idPath = refId ? `/${refId}` : `/${timestamp}`;

  let folder = `general${idPath}`;
  if (purpose === "product") {
    folder = `products${idPath}`;
  } else if (purpose === "blog") {
    folder = `blogs${idPath}`;
  }

  const fileExt = filename.split(".").pop()?.toLowerCase() || "";
  const baseName = filename
    .replace(new RegExp(`\\.${fileExt}$`, "i"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const key = `${folder}/${baseName ? baseName + "." : ""}${fileExt}`;

  const command = new PutObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    ContentType: contentType,
  });

  // URL expires in 5 minutes (300 seconds)
  const presignedUrl = await getSignedUrl(r2Client, command, {
    expiresIn: 300,
  });
  const publicUrl = mergeMediaBaseUrl(key);

  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Presigned URL generated successfully",
    data: { presignedUrl, key, url: publicUrl },
  });
});

const createImage = catchAsync(async (req, res) => {
  const uploadedBy = req.user.id || req.user._id;

  if (!uploadedBy) {
    throw new ApiError(
      httpStatus.UNAUTHORIZED,
      "User not authorized or ID missing"
    );
  }

  const files = (req.files as Express.Multer.File[]) || [];
  const purpose =
    (req.body.purpose as "product" | "blog" | "general") || "general";
  const refId = req.body.refId;

  // Case 1: Files uploaded directly to server via multipart/form-data
  if (files && files.length > 0) {
    const maxCount = Number(config.upload_image_maxCount) || 10;
    if (files.length > maxCount) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `You can only upload a maximum of ${maxCount} files at once.`
      );
    }

    const imagesToSave = [];

    for (const file of files) {
      // 1. Process image: Convert to WebP while maintaining high quality
      let webpBuffer: Buffer;
      try {
        webpBuffer = await sharp(file.buffer)
          .rotate()
          .webp({ quality: 90, effort: 4 })
          .toBuffer();
      } catch (err: any) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Failed to process image "${file.originalname}": ${
            err?.message || "Invalid image file"
          }`
        );
      }

      // 2. Build folder and SEO-friendly key
      const timestamp = Date.now();
      const idPath = refId ? `/${refId}` : `/${timestamp}`;

      let folder = `general${idPath}`;
      if (purpose === "product") {
        folder = `products${idPath}`;
      } else if (purpose === "blog") {
        folder = `blogs${idPath}`;
      }

      const originalNameWithoutExt = path.parse(file.originalname).name;
      const cleanBaseName =
        originalNameWithoutExt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "image";

      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const fileName = `${cleanBaseName}-${randomSuffix}.webp`;
      const key = `${folder}/${fileName}`;

      // 3. Hybrid upload check: R2 or Local
      if (config.upload_platform === "r2") {
        const command = new PutObjectCommand({
          Bucket: config.r2.bucketName,
          Key: key,
          Body: webpBuffer,
          ContentType: "image/webp",
        });
        await r2Client.send(command);
      } else {
        const { publicUploadDir } = getUploadDirectories();
        const localDir = path.join(publicUploadDir, folder);
        await fs.promises.mkdir(localDir, { recursive: true });
        const localFilePath = path.join(localDir, fileName);
        await fs.promises.writeFile(localFilePath, webpBuffer);
      }

      // 4. Save relative key to DB
      imagesToSave.push({
        src: key,
        alt: req.body.alt || originalNameWithoutExt || "Image",
        purpose,
        uploadedBy,
      });
    }

    const result = await ImageServices.createImageIntoDB(imagesToSave);
    return successResponse(res, {
      statusCode: httpStatus.CREATED,
      message: "Image(s) uploaded successfully!",
      data: result,
    });
  }

  // Case 2: Legacy JSON payload
  const payloadImages = req.body.images as {
    src: string;
    alt: string;
    purpose?: "product" | "blog" | "general";
  }[];
  if (!payloadImages || payloadImages.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No images or files provided");
  }

  const images = payloadImages.map((img) => {
    return {
      src: extractMediaKey(img.src),
      alt: img.alt,
      purpose: img.purpose ?? "general",
      uploadedBy,
    };
  });
  const result = await ImageServices.createImageIntoDB(images);
  successResponse(res, {
    statusCode: httpStatus.CREATED,
    message: "Image created successfully!",
    data: result,
  });
});

const getAllImages = catchAsync(async (req, res) => {
  const { meta, data } = await ImageServices.getAllImagesFromDB(req.query);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "All images retrieved successfully!",
    meta: meta,
    data: data,
  });
});

const getAnImage = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await ImageServices.getAnImageFromDB(id);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "An image retrieved successfully!",
    data: result,
  });
});

const deleteImages = catchAsync(async (req, res) => {
  const deletedBy = req.user.id;
  const { imageIds } = req.body;
  await ImageServices.deleteImagesFromDB(deletedBy, imageIds);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Images deleted successfully!",
    data: null,
  });
});

export const ImageControllers = {
  generatePresignedUrl,
  createImage,
  getAnImage,
  getAllImages,
  deleteImages,
};
