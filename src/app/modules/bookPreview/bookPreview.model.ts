import { Schema, model } from "mongoose";
import { TBookPreview } from "./bookPreview.interface";
import { extractMediaKey, mergeMediaBaseUrl } from "../../utilities/mediaPath";

const bookPreviewSchema = new Schema<TBookPreview>(
  {
    src: {
      type: String,
      required: true,
      set: (val: string) => extractMediaKey(val),
      get: (val: string) => mergeMediaBaseUrl(val),
    },
    alt: {
      type: String,
      required: true,
    },
    previewType: {
      type: String,
      enum: ["short", "full", "free"],
      default: "short",
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

bookPreviewSchema.pre("save", function (next) {
  if (this.src) {
    this.src = extractMediaKey(this.src);
  }
  next();
});

export const BookPreviewModel = model<TBookPreview>(
  "BookPreview",
  bookPreviewSchema
);
