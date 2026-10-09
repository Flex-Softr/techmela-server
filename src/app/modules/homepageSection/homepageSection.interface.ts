import { Document, Types } from "mongoose";
import { TCollection } from "../productManagement/collection/collection.interface";
import { TImage } from "../image/image.interface";

export type THomePageInput = {
  title?: string;
  subtitle?: string;
  image?: Types.ObjectId | string | TImage | null;
  collectionId: string | TCollection;
  sortOrder?: number;
  limit?: number;
  ctaText?: string;
  ctaLink?: string;
  isActive?: boolean;
};

export type THomePageSection = Document & THomePageInput;

