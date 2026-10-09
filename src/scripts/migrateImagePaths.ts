import mongoose from "mongoose";
import config from "../app/config/config";
import { ImageModel } from "../app/modules/image/image.model";
import { BookPreviewModel } from "../app/modules/bookPreview/bookPreview.model";
import { extractMediaKey } from "../app/utilities/mediaPath";
import { consoleLogger } from "../app/utilities/logger";

const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.DBUrl as string);
    consoleLogger.info("✅ Connected to MongoDB");
  } catch (error) {
    consoleLogger.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

const migrateImagePaths = async (): Promise<void> => {
  try {
    await connectDB();

    consoleLogger.info("🔄 Starting media path migration to relative keys...");

    // 1. Migrate Image collection
    const allImages = await ImageModel.find({}, "_id src").lean();
    let updatedImagesCount = 0;

    for (const img of allImages) {
      if (img.src) {
        const cleanKey = extractMediaKey(img.src);
        if (cleanKey !== img.src) {
          await ImageModel.collection.updateOne(
            { _id: img._id },
            { $set: { src: cleanKey } }
          );
          updatedImagesCount++;
        }
      }
    }
    consoleLogger.info(
      `✅ Image collection migration complete. Updated ${updatedImagesCount} / ${allImages.length} documents.`
    );

    // 2. Migrate BookPreview collection
    const allPreviews = await BookPreviewModel.find({}, "_id src").lean();
    let updatedPreviewsCount = 0;

    for (const preview of allPreviews) {
      if (preview.src) {
        const cleanKey = extractMediaKey(preview.src);
        if (cleanKey !== preview.src) {
          await BookPreviewModel.collection.updateOne(
            { _id: preview._id },
            { $set: { src: cleanKey } }
          );
          updatedPreviewsCount++;
        }
      }
    }
    consoleLogger.info(
      `✅ BookPreview collection migration complete. Updated ${updatedPreviewsCount} / ${allPreviews.length} documents.`
    );

    consoleLogger.info("🎉 All media path migrations completed successfully!");
    process.exit(0);
  } catch (error) {
    consoleLogger.error("❌ Media path migration failed:", error);
    process.exit(1);
  }
};

// eslint-disable-next-line no-undef
if (require.main === module) {
  migrateImagePaths();
}

export default migrateImagePaths;
