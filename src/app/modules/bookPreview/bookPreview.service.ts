import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import config from "../../config/config";
import { QueryHelper } from "../../helper/query.helper";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from "../../config/r2.config";
import { TBookPreview } from "./bookPreview.interface";
import { BookPreviewModel } from "./bookPreview.model";

import {
  extractMediaKey,
  getUploadDirectories,
} from "../../utilities/mediaPath";

const createBookPreviewIntoDB = async (payload: Partial<TBookPreview[]>) => {
  const normalizedPayload = Array.isArray(payload)
    ? payload.map((preview) => ({
        ...preview,
        src: extractMediaKey(preview?.src),
      }))
    : payload;
  const result = await BookPreviewModel.create(normalizedPayload);
  return result;
};

const getABookPreviewFromDB = async (id: string) => {
  if (id != "undefined") {
    const result = await BookPreviewModel.findById(id, "_id src alt");
    return result;
  } else {
    return {};
  }
};

const getAllBookPreviewsFromDB = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = { isDeleted: false };
  if (query.previewType) {
    filter.previewType = query.previewType;
  }
  const previewQuery = new QueryHelper<TBookPreview>(
    BookPreviewModel.find(filter),
    query
  )
    .search(["alt"])
    .sort()
    .paginate();
  const data: TBookPreview[] =
    (await previewQuery.model) as unknown as TBookPreview[];
  const meta = await previewQuery.metaData();
  return { meta, data };
};

const deleteBookPreviewsFromDB = async (
  deletedBy: Types.ObjectId,
  previewIds: string[]
) => {
  if (previewIds.length) {
    for (const id of previewIds) {
      const result = await BookPreviewModel.findByIdAndUpdate(id, {
        deletedBy,
        isDeleted: true,
      });
      if (result) {
        const key = extractMediaKey(result.src);
        if (config.upload_platform === "r2") {
          try {
            const command = new DeleteObjectCommand({
              Bucket: config.r2.bucketName,
              Key: key,
            });
            await r2Client.send(command);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Failed to delete object from R2:", error);
          }
        } else {
          try {
            const { previewsDir } = getUploadDirectories();
            const localFilePath = path.join(previewsDir, key);
            if (fs.existsSync(localFilePath)) {
              await fs.promises.unlink(localFilePath);
            }
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Failed to delete local preview file:", error);
          }
        }
      }
    }
  }
};

export const BookPreviewServices = {
  createBookPreviewIntoDB,
  getABookPreviewFromDB,
  getAllBookPreviewsFromDB,
  deleteBookPreviewsFromDB,
};
