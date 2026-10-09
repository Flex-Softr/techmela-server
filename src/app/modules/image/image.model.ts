import { Schema, model } from "mongoose";
import { TImage } from "./image.interface";
import { extractMediaKey, mergeMediaBaseUrl } from "../../utilities/mediaPath";

const imageSchema = new Schema<TImage>(
  {
    src: {
      type: String,
      required: true,
      set: (val: string) => extractMediaKey(val),
      get: (val: string) => mergeMediaBaseUrl(val),
    },
    alt: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    purpose: {
      type: String,
      enum: ["product", "blog", "general"],
      default: "general",
      index: true,
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

imageSchema.pre("save", function (next) {
  if (this.src) {
    this.src = extractMediaKey(this.src);
  }
  next();
});

export const ImageModel = model<TImage>("Image", imageSchema);
