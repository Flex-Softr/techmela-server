import httpStatus from "http-status";
import ApiError from "../../errorHandlers/ApiError";
import { TCollection } from "../productManagement/collection/collection.interface";
import { ProductServices } from "../productManagement/product/product.service";
import { THomePageInput } from "./homepageSection.interface";
import { HomepageSectionModel } from "./homepageSection.model";

const createHomepageSection = async (payload: THomePageInput) => {
  const data: Partial<THomePageInput> = { ...payload };
  if (!data.image) {
    delete data.image;
  }
  const result = await HomepageSectionModel.create(data);
  return result.populate("collectionId image");
};

const getAllHomepageSections = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};
  if (query.isActive) {
    filter.isActive = query.isActive === "true";
  }

  const result = await HomepageSectionModel.find(filter)
    .populate("collectionId")
    .populate("image")
    .sort({ sortOrder: 1, updatedAt: -1 });
  return result;
};

const getHomepageSectionById = async (id: string) => {
  const result = await HomepageSectionModel.findById(id)
    .populate("collectionId")
    .populate("image");
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Homepage Section not found!");
  }
  return result;
};

const updateHomepageSection = async (
  id: string,
  payload: Partial<THomePageInput>
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = { ...payload };
  if (updateData.image === "" || updateData.image === null) {
    updateData.image = null;
  }

  const result = await HomepageSectionModel.findByIdAndUpdate(id, updateData, {
    new: true,
  })
    .populate("collectionId")
    .populate("image");

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Homepage Section not found!");
  }

  return result;
};

const deleteHomepageSection = async (id: string) => {
  const result = await HomepageSectionModel.findByIdAndDelete(id);

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Homepage Section not found!");
  }

  return result;
};

const getHomepageSectionContent = async (id: string) => {
  const result =
    await HomepageSectionModel.findById(id).populate("collectionId");

  if (!result?.collectionId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { meta: {} as any, data: [] };
  }

  const products = await ProductServices.getAllProductsCustomerFromDB({
    collection: (result?.collectionId as TCollection)?.slug,
    limit: result?.limit,
    sort: "-updatedAt",
  });
  return products;
};

export const HomepageSectionService = {
  createHomepageSection,
  getAllHomepageSections,
  getHomepageSectionById,
  updateHomepageSection,
  deleteHomepageSection,
  getHomepageSectionContent,
};
