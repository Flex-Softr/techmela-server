import fs from "fs";
import httpStatus from "http-status";
import path from "path";
import ApiError from "../../errorHandlers/ApiError";
import catchAsync from "../../utilities/catchAsync";
import successResponse from "../../utilities/successResponse";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import config from "../../config/config";
import { r2Client } from "../../config/r2.config";
import { BookPreviewServices } from "./bookPreview.service";

import { extractMediaKey, mergeMediaBaseUrl } from "../../utilities/mediaPath";

const generatePresignedUrl = catchAsync(async (req, res) => {
  const { filename, contentType, previewType, bookId } = req.body;
  if (!filename || !contentType) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Filename and contentType are required"
    );
  }

  // Create an SEO-friendly unique key for the file
  const timestamp = Date.now();
  const idPath = bookId ? `/${bookId}` : `/${timestamp}`;

  let folder = `books${idPath}`; // fallback
  if (previewType === "free") {
    folder = `free-books${idPath}`;
  } else if (previewType === "short" || previewType === "full") {
    folder = `preview-books${idPath}`;
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

  // URL expires in 5 minutes
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

const createBookPreview = catchAsync(async (req, res) => {
  const uploadedBy = req.user.id || req.user._id;

  if (!uploadedBy) {
    throw new ApiError(
      httpStatus.UNAUTHORIZED,
      "User not authorized or ID missing"
    );
  }

  const files = (req.files as Express.Multer.File[]) || [];
  const previewType =
    (req.body.previewType as "short" | "full" | "free") || "short";
  const bookId = req.body.bookId;

  // Case 1: Files uploaded directly to server via multipart/form-data
  if (files && files.length > 0) {
    const previewsToSave = [];

    for (const file of files) {
      const timestamp = Date.now();
      const idPath = bookId ? `/${bookId}` : `/${timestamp}`;

      let folder = `books${idPath}`;
      if (previewType === "free") {
        folder = `free-books${idPath}`;
      } else if (previewType === "short" || previewType === "full") {
        folder = `preview-books${idPath}`;
      }

      const originalNameWithoutExt = path.parse(file.originalname).name;
      const cleanBaseName =
        originalNameWithoutExt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "preview";

      const fileExt =
        path.extname(file.originalname).toLowerCase() || ".pdf";
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const fileName = `${cleanBaseName}-${randomSuffix}${fileExt}`;
      const key = `${folder}/${fileName}`;

      // Hybrid upload: R2 or Local
      if (config.upload_platform === "r2") {
        const command = new PutObjectCommand({
          Bucket: config.r2.bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype || "application/pdf",
        });
        await r2Client.send(command);
      } else {
        const localDir = path.join(
          process.cwd(),
          "uploads/previews",
          folder
        );
        await fs.promises.mkdir(localDir, { recursive: true });
        const localFilePath = path.join(localDir, fileName);
        await fs.promises.writeFile(localFilePath, file.buffer);
      }

      previewsToSave.push({
        src: key,
        alt: req.body.alt || originalNameWithoutExt || "Book Preview",
        previewType,
        uploadedBy,
        isDeleted: false,
      });
    }

    const result =
      await BookPreviewServices.createBookPreviewIntoDB(previewsToSave);
    return successResponse(res, {
      statusCode: httpStatus.CREATED,
      message: "Book preview(s) uploaded successfully!",
      data: result,
    });
  }

  // Case 2: Legacy JSON payload
  const payloadPreviews = req.body.previews as {
    src: string;
    alt: string;
    previewType?: "short" | "full" | "free";
  }[];
  if (!payloadPreviews || payloadPreviews.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No previews or files provided");
  }

  const previews = payloadPreviews.map((preview) => {
    return {
      src: extractMediaKey(preview.src),
      alt: preview.alt,
      previewType: preview.previewType || "short",
      uploadedBy,
      isDeleted: false,
    };
  });

  const result = await BookPreviewServices.createBookPreviewIntoDB(previews);
  successResponse(res, {
    statusCode: httpStatus.CREATED,
    message: "Book preview created successfully!",
    data: result,
  });
});

const getAllBookPreviews = catchAsync(async (req, res) => {
  const { meta, data } = await BookPreviewServices.getAllBookPreviewsFromDB(
    req.query
  );
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "All book previews retrieved successfully!",
    meta: meta,
    data: data,
  });
});

const getABookPreview = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await BookPreviewServices.getABookPreviewFromDB(id);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "A book preview retrieved successfully!",
    data: result,
  });
});

const deleteBookPreviews = catchAsync(async (req, res) => {
  const deletedBy = req.user.id;
  const { previewIds } = req.body;
  await BookPreviewServices.deleteBookPreviewsFromDB(deletedBy, previewIds);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Book previews deleted successfully!",
    data: null,
  });
});

export const BookPreviewControllers = {
  generatePresignedUrl,
  createBookPreview,
  getABookPreview,
  getAllBookPreviews,
  deleteBookPreviews,
};
