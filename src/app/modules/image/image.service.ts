import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import config from "../../config/config";
import { QueryHelper } from "../../helper/query.helper";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from "../../config/r2.config";
import { TImage } from "./image.interface";
import { ImageModel } from "./image.model";

import { extractMediaKey } from "../../utilities/mediaPath";

const createImageIntoDB = async (payload: Partial<TImage[]>) => {
  const normalizedPayload = Array.isArray(payload)
    ? payload.map((img) => ({
        ...img,
        src: extractMediaKey(img?.src),
      }))
    : payload;
  const result = await ImageModel.create(normalizedPayload);
  return result;
};

const getAnImageFromDB = async (id: string) => {
  if (id != "undefined") {
    const result = await ImageModel.findById(id, "_id src alt");
    return result;
  } else {
    return {};
  }
};

const getAllImagesFromDB = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = { isDeleted: false };
  if (query.purpose) {
    if (query.purpose === "product" || query.purpose === "blog") {
      filter.purpose = { $in: [query.purpose, "general"] };
    } else {
      filter.purpose = query.purpose;
    }
  }
  const imageQuery = new QueryHelper<TImage>(ImageModel.find(filter), query)
    .sort()
    .paginate();
  const data: TImage[] = (await imageQuery.model) as unknown as TImage[];
  const meta = await imageQuery.metaData();
  return { meta, data };
};

const deleteImagesFromDB = async (
  deletedBy: Types.ObjectId,
  imageIds: string[]
) => {
  if (imageIds.length) {
    for (const id of imageIds) {
      const result = await ImageModel.findByIdAndUpdate(id, {
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
            const localFolder = config.local_upload_folder || "uploads/public";
            const localFilePath = path.join(process.cwd(), localFolder, key);
            if (fs.existsSync(localFilePath)) {
              await fs.promises.unlink(localFilePath);
            }
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Failed to delete local image file:", error);
          }
        }
      }
    }
  }
};

export const ImageServices = {
  createImageIntoDB,
  getAnImageFromDB,
  getAllImagesFromDB,
  deleteImagesFromDB,
};
