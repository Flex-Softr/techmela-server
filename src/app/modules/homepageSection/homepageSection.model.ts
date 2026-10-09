import { Schema, model } from "mongoose";
import { THomePageSection } from "./homepageSection.interface";

const homepageSectionSchema = new Schema<THomePageSection>(
  {
    title: { type: String },
    subtitle: { type: String },
    image: { type: Schema.Types.ObjectId, ref: "Image" },
    collectionId: {
      type: String,
      required: true,
      ref: "Collection",
    },
    sortOrder: { type: Number, default: 1 },
    limit: {
      type: Number,
      default: 4,
    },
    ctaText: { type: String },
    ctaLink: { type: String },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const HomepageSectionModel = model<THomePageSection>(
  "HomepageSection",
  homepageSectionSchema
);
