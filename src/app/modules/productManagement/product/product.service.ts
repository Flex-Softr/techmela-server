/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status";
import mongoose, { PipelineStage, Types } from "mongoose";
import ApiError from "../../../errorHandlers/ApiError";
import { AggregateQueryHelper } from "../../../helper/query.helper";
import generateProductId from "../../../utilities/generateProductId";
import { InventoryModel } from "../inventory/inventory.model";
import PriceModel from "../price/price.model";
import { create } from "xmlbuilder2";
import config from "../../../config/config";
import { mergeMediaBaseUrl } from "../../../utilities/mediaPath";
import {
  AggregateQueryHelperFacet,
  ExtendedPipelineStage,
} from "../../../helper/query.helper";
import { Order } from "../../orderManagement/order/order.model";
import { calculateStockStatus } from "../inventory/inventory.utils";
import VariationModel from "../variation/variation.model";
import { PRODUCT_STATUS, PRODUCT_TYPE } from "./product.const";
import { TProductPayload } from "./product.interface";
import ProductModel from "./product.model";
import {
  calculateStockAvailable,
  commonPipelineMultipleProduct,
  commonPipelineSingleProduct,
  commonProductProjection,
  formatPriceUpdatePayload,
  stripHtmlAndEntities,
} from "./product.utils";
import SeoModel from "../../seo/seo.model";

const createProductIntoDB = async (
  createdBy: Types.ObjectId,
  payload: TProductPayload
) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // 1. Initialize variables
    let price;
    let inventory;
    let variationIds: Types.ObjectId[] = [];

    const generatedProductId = await generateProductId();

    // 2. Logic based on Product Type
    if (payload.type === PRODUCT_TYPE.SIMPLE) {
      // --- Simple Product Logic ---

      // Create Price
      if (payload.price) {
        [price] = await PriceModel.create([payload.price], { session });
      }

      // Create Inventory
      if (payload.inventory) {
        [inventory] = await InventoryModel.create([payload.inventory], {
          session,
        });
      }

      // Ensure no variations or attributes for simple products
      payload.variations = [];
      payload.attributes = [];
    } else if (payload.type === PRODUCT_TYPE.VARIABLE) {
      // --- Variable Product Logic ---

      // Variations must exist
      if (payload.variations && payload.variations.length > 0) {
        // Collect all price and inventory payloads
        const pricePayloads = payload.variations.map((v) => v.price);
        const inventoryPayloads = payload.variations.map((v) => v.inventory);

        // Batch create prices and inventories
        const createdPrices = await PriceModel.insertMany(pricePayloads, {
          session,
        });
        const createdInventories = await InventoryModel.insertMany(
          inventoryPayloads,
          { session }
        );

        // Map back to variations
        const variationsData = payload.variations.map((v, i) => ({
          serial: i + 1,
          productId: generatedProductId,
          attributes: v.attributes,
          price: createdPrices[i]._id,
          inventory: createdInventories[i]._id,
          isActive: v.isActive,
        }));

        const insertedVariations = await VariationModel.insertMany(
          variationsData,
          { session }
        );
        variationIds = insertedVariations.map((v) => v._id);
      }

      // Root price and inventory remain undefined for variable products
    }

    // 4. Construct Final Product Object
    // Note: Attributes, Category, Brand, Image are passed directly.
    // 4. Construct Final Product Object
    // Note: Attributes, Category, Brand, Image are passed directly.
    let productData: any = {
      ...payload,
      id: generatedProductId,
      createdBy,
    };

    if (payload.type === PRODUCT_TYPE.SIMPLE) {
      productData = {
        ...productData,
        price: price?._id,
        inventory: inventory?._id,
        variations: [],
      };
    } else {
      productData = {
        ...productData,
        variations: variationIds,
        // Ensure properties not relevant to variable products are removed
        price: undefined,
        inventory: undefined,
      };
    }

    const isProductDeleted = await ProductModel.findOne({
      slug: payload.slug,
      isDeleted: true,
    });

    let product;

    if (payload.seo) {
      const [seoDoc] = await SeoModel.create([payload.seo], { session });
      productData.seo = seoDoc._id;
    }

    if (isProductDeleted) {
      product = await ProductModel.findByIdAndUpdate(
        isProductDeleted._id,
        { ...productData, isDeleted: false },
        { new: true, session }
      );
    } else {
      [product] = await ProductModel.create([productData], { session });
    }

    await session.commitTransaction();
    return product;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getAProductCustomerFromDB = async (slug: string) => {
  const pipeline = [
    {
      $match: {
        slug: slug,
        isDeleted: false,
        publishedStatus: PRODUCT_STATUS.PUBLISHED,
      },
    },
    ...commonPipelineSingleProduct([
      {
        $match: {
          isActive: { $ne: false },
        },
      },
    ]),
  ];

  const result = await ProductModel.aggregate(pipeline as PipelineStage[]);

  if (!result) {
    throw new ApiError(httpStatus.BAD_REQUEST, "The product was not found!");
  }
  return result[0];
};

const getAProductAdminFromDB = async (id: string) => {
  const pipeline = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
        isDeleted: false,
      },
    },
    ...commonPipelineSingleProduct(),
  ];

  const result = await ProductModel.aggregate(pipeline as PipelineStage[]);

  if (!result) {
    throw new ApiError(httpStatus.BAD_REQUEST, "The product was not found!");
  }

  return result[0];
};

const getAllProductsCustomerFromDB = async (query: Record<string, unknown>) => {
  const { minPrice, maxPrice, category, collection, brand } = query;

  const filterQuery: Record<string, unknown> = {};
  const andConditions: Record<string, unknown>[] = [];

  // Price filter
  if (minPrice && maxPrice) {
    const min = Number(minPrice);
    const max = Number(maxPrice);

    andConditions.push({
      $or: [
        // Simple product
        {
          $or: [
            { "price.salePrice": { $gte: min, $lte: max } },
            {
              "price.salePrice": { $in: [null] },
              "price.regularPrice": { $gte: min, $lte: max },
            },
          ],
        },

        // Variation product
        {
          variations: {
            $elemMatch: {
              $or: [
                { "price.salePrice": { $gte: min, $lte: max } },
                {
                  "price.salePrice": { $in: [null] },
                  "price.regularPrice": { $gte: min, $lte: max },
                },
              ],
            },
          },
        },
      ],
    });
  }

  // Category filter
  if (typeof category === "string" && category.trim()) {
    const categoryArray = category.split(",");
    andConditions.push({
      category: {
        $elemMatch: { slug: { $in: categoryArray } },
      },
    });
  }

  // Brand filter
  if (typeof brand === "string" && brand.trim()) {
    const brandArray = brand.split(",");
    andConditions.push({
      "brand.slug": { $in: brandArray },
    });
  }

  // Collection filter
  if (typeof collection === "string" && collection.trim()) {
    const collectionArray = collection.split(",");
    andConditions.push({
      productCollection: {
        $elemMatch: { slug: { $in: collectionArray } },
      },
    });
  }

  // Stock filter
  if (typeof query.stock === "string" && query.stock.trim()) {
    andConditions.push({
      $or: [
        { "inventory.stockStatus": query.stock },
        { "variations.inventory.stockStatus": query.stock },
      ],
    });
  }

  if (andConditions.length > 0) {
    filterQuery.$and = andConditions;
  }

  // Initial $match — `featured` must be filtered here because it is a
  // root-level field on the product document (before any lookup pipeline).
  const initialMatch: Record<string, unknown> = {
    isDeleted: false,
    publishedStatus: PRODUCT_STATUS.PUBLISHED,
  };

  if (query.featured === "true") {
    initialMatch.featured = true;
  }

  const pipeline: ExtendedPipelineStage[] = [
    {
      $match: initialMatch,
    },
    ...commonPipelineMultipleProduct,
    { $match: filterQuery },
    {
      $facet: {
        // Define sub-pipeline 2: For other operations
        data: [
          {
            $project: commonProductProjection,
          },
        ],
        // Define sub-pipeline 1: For getting total count
        total: [
          {
            $count: "total",
          },
        ],
      },
    },
    { $unwind: "$total" },
    {
      $project: {
        data: 1,
        total: "$total.total",
      },
    },
  ];

  const productQuery = new AggregateQueryHelperFacet(
    ProductModel,
    pipeline,
    query
  )
    .search([
      "title",
      "shortDescription",
      "description",
      "category.name",
      "brand.name",
      "productCollection.name",
    ])
    .sort()
    .select()
    .paginate();
  const data = await productQuery.metaData();

  return { ...data };
};

const getAllProductsAdminFromDB = async (query: Record<string, unknown>) => {
  const { status, stock, category, collection, brand } = query;
  const filterQuery: Record<string, unknown> = {};
  const andConditions: Record<string, unknown>[] = [];

  if (status && status !== "all") {
    andConditions.push({ publishedStatus: status });
  }

  // Category or Subcategory ID filter
  if (category) {
    const categoryId = new mongoose.Types.ObjectId(category as string); // Convert the category query to ObjectId
    andConditions.push({ "category._id": categoryId });
  }

  if (collection) {
    const collectionId = new mongoose.Types.ObjectId(collection as string);
    andConditions.push({ "productCollection._id": collectionId });
  }

  if (brand) {
    const brandId = new mongoose.Types.ObjectId(brand as string);
    andConditions.push({ "brand._id": brandId });
  }

  if (stock) {
    andConditions.push({
      $or: [
        { "inventory.stockStatus": stock },
        { "variations.inventory.stockStatus": stock },
      ],
    });
  }

  if (andConditions.length > 0) {
    filterQuery.$and = andConditions;
  }

  const pipeline = [
    { $match: { isDeleted: false } },
    ...commonPipelineMultipleProduct,
    { $match: filterQuery },
    {
      $facet: {
        // Define sub-pipeline 2: For other operations
        data: [
          {
            $project: {
              id: 1,
              title: 1,
              slug: 1,
              type: 1,
              variations: 1,
              regularPrice: "$price.regularPrice",
              salePrice: "$price.salePrice",
              sku: "$inventory.sku",
              stockStatus: "$inventory.stockStatus",
              stockAvailable: "$inventory.stockAvailable",
              manageStock: "$inventory.manageStock",
              totalReview: { $size: "$review" },
              averageRating: { $avg: "$review.rating" },
              thumbnail: {
                _id: "$thumbnail._id",
                src: "$thumbnail.src",
                alt: "$thumbnail.alt",
              },
              category: 1,
              // productCollection: "$productCollection",
              publishedStatus: 1,
              createdAt: 1,
              updatedAt: 1,
              // Calculated active price for sorting
              price: {
                $cond: {
                  if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
                  then: {
                    $min: {
                      $map: {
                        input: "$variations.price",
                        as: "vp",
                        in: {
                          $ifNull: ["$$vp.salePrice", "$$vp.regularPrice"],
                        },
                      },
                    },
                  },
                  else: {
                    $ifNull: ["$price.salePrice", "$price.regularPrice"],
                  },
                },
              },
            },
          },
        ],
        // Define sub-pipeline 1: For getting total count
        total: [
          {
            $count: "total",
          },
        ],
      },
    },
    { $unwind: "$total" },
    {
      $project: {
        data: 1,
        total: "$total.total",
      },
    },
  ];

  // get counts
  const statusMap = {
    all: 0,
    [PRODUCT_STATUS.PUBLISHED]: 0,
    // [PRODUCT_STATUS.DRAFT]: 0, // enable when need
    [PRODUCT_STATUS.PRIVATE]: 0,
  };

  const statusPipeline = [
    {
      $match: {
        isDeleted: false,
        publishedStatus: {
          $in: Object.values(PRODUCT_STATUS),
        },
      },
    },
    {
      $group: {
        _id: "$publishedStatus",
        total: { $sum: 1 },
      },
    },
  ];

  const result = await ProductModel.aggregate(statusPipeline);

  result.forEach(({ _id, total }: { _id: string; total: number }) => {
    if (_id in statusMap) {
      statusMap[_id as keyof typeof statusMap] = total;
    }
    statusMap.all += total;
  });

  const formattedResult = Object.entries(statusMap).map(([name, total]) => ({
    name,
    total,
  }));

  const productQuery = new AggregateQueryHelperFacet(
    ProductModel,
    pipeline as any,
    query
  )
    .search([
      "title",
      "inventory.salePrice",
      "inventory.sku",
      "variations.inventory.sku",
      "description",
      "category.name",
      "brand.name",
    ])
    .sort()
    .paginate();

  const data = await productQuery.metaData();

  return { ...data, countsByStatus: formattedResult };
};

const getFeaturedProductsFromDB = async (query: Record<string, unknown>) => {
  const pipeline = [
    {
      $match: {
        isDeleted: false,
        featured: true,
        publishedStatus: PRODUCT_STATUS.PUBLISHED,
      },
    },
    ...commonPipelineMultipleProduct,
    {
      $project: commonProductProjection,
    },
  ];

  const productQuery = new AggregateQueryHelper(
    ProductModel.aggregate(pipeline as any),
    query
  )
    .sort()
    .paginate();

  const data = await productQuery.model;
  const total = (await ProductModel.aggregate(pipeline as any)).length;
  const meta = productQuery.metaData(total);
  return { meta, data };
};

const getBestSellingProductsFromDB = async (query: Record<string, unknown>) => {
  const pipeline: PipelineStage[] = [
    {
      $match: { status: { $ne: "deleted" } },
    },
    {
      $unwind: "$orderedProducts",
    },
    {
      $group: {
        _id: "$orderedProducts.product",
        totalQuantity: { $sum: "$orderedProducts.quantity" },
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: "$product",
    },
    {
      $lookup: {
        from: "prices",
        localField: "product.price",
        foreignField: "_id",
        as: "price",
        pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }] as any[],
      },
    },
    {
      $lookup: {
        from: "images",
        localField: "product.image.thumbnail",
        foreignField: "_id",
        as: "thumbnail",
        pipeline: [
          {
            $project: {
              src: "$src",
              alt: 1,
            },
          },
        ] as any[],
      },
    },
    {
      $lookup: {
        from: "inventories",
        localField: "product.inventory",
        foreignField: "_id",
        as: "inventory",
        pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }] as any[],
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "product.category",
        foreignField: "_id",
        as: "category",
        pipeline: [{ $project: { _id: 1, name: 1, slug: 1 } }] as any[],
      },
    },
    {
      $lookup: {
        from: "variations",
        localField: "product.variations",
        foreignField: "_id",
        as: "variations",
        pipeline: [
          { $sort: { serial: 1 } },
          {
            $lookup: {
              from: "prices",
              localField: "price",
              foreignField: "_id",
              as: "price",
              pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }] as any[],
            },
          },
          { $unwind: { path: "$price", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "inventories",
              localField: "inventory",
              foreignField: "_id",
              as: "inventory",
              pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }] as any[],
            },
          },
          { $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              createdAt: 0,
              updatedAt: 0,
            },
          },
        ] as any[],
      },
    },
    {
      $lookup: {
        from: "brands",
        localField: "product.brand",
        foreignField: "_id",
        as: "brand",
        pipeline: [{ $project: { name: 1, slug: 1 } }] as any[],
      },
    },
    // Promote product fields to root level
    {
      $addFields: {
        _id: "$product._id",
        id: "$product.id",
        title: "$product.title",
        slug: "$product.slug",
        type: "$product.type",
        createdAt: "$product.createdAt",
        updatedAt: "$product.updatedAt",
        publishedStatus: "$product.publishedStatus",
        isDeleted: "$product.isDeleted",
      },
    },
    // Only include published, non-deleted products
    {
      $match: {
        isDeleted: false,
        publishedStatus: PRODUCT_STATUS.PUBLISHED,
      },
    },
    {
      $unwind: { path: "$price", preserveNullAndEmptyArrays: true },
    },
    {
      $unwind: "$thumbnail",
    },
    {
      $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true },
    },
    {
      $unwind: { path: "$brand", preserveNullAndEmptyArrays: true },
    },
    {
      $project: {
        ...commonProductProjection,
        totalQuantity: 1,
      },
    },
  ];

  // Default sort by totalQuantity descending (best selling first)
  const queryWithDefaultSort = { sort: "-totalQuantity", ...query };
  const productQuery = new AggregateQueryHelper(
    Order.aggregate(pipeline),
    queryWithDefaultSort
  )
    .sort()
    .paginate();

  const data = await productQuery.model;
  const total = (await Order.aggregate(pipeline)).length;
  const meta = productQuery.metaData(total);
  return { meta, data };
};

const getRelatedProductsFromDB = async (slug: string) => {
  const product = await ProductModel.findOne({ slug, isDeleted: false });

  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, "Product not found!");
  }

  if (!product.relatedProducts || product.relatedProducts.length === 0) {
    return [];
  }

  // Keep the ordered list of ObjectIds as declared on the product
  const orderedIds = product.relatedProducts.map(
    (id) => new Types.ObjectId(id.toString())
  );

  const pipeline: PipelineStage[] = [
    {
      $match: {
        _id: { $in: orderedIds },
        isDeleted: false,
        publishedStatus: PRODUCT_STATUS.PUBLISHED,
      },
    },
    ...(commonPipelineMultipleProduct as PipelineStage[]),
    {
      $project: commonProductProjection,
    },
    // Inject a numeric sort key that reflects the original array position
    {
      $addFields: {
        _sortIndex: {
          $indexOfArray: [orderedIds, "$_id"],
        },
      },
    },
    { $sort: { _sortIndex: 1 } },
    // Remove the helper field before returning
    { $unset: "_sortIndex" },
  ];

  const result = await ProductModel.aggregate(pipeline);

  return result;
};

export const getProductPriceRangeFromDB = async (
  query: Record<string, unknown>
) => {
  const filterQuery: Record<string, unknown> = {};
  const { category, subCategory, brand, collection } = query;

  const filterConditions = [];

  // Category filter
  if (typeof category === "string") {
    const categoryArray = category?.split(",") || [];
    if (categoryArray.length > 0) {
      filterConditions.push({
        category: { $elemMatch: { slug: { $in: categoryArray } } },
      });
    }
  }

  // Subcategory filter
  if (typeof subCategory === "string") {
    const subcategoryArray = subCategory?.split(",") || [];
    if (subcategoryArray.length > 0) {
      filterConditions.push({
        category: { $elemMatch: { slug: { $in: subcategoryArray } } },
      });
    }
  }

  // Brand filter
  if (typeof brand === "string") {
    const brandArray = brand?.split(",") || [];
    if (brandArray.length > 0) {
      filterQuery["brand.slug"] = { $in: brandArray };
    }
  }

  // Collection filter
  if (typeof collection === "string") {
    const collectionArray = collection?.split(",") || [];
    if (collectionArray.length > 0) {
      filterQuery["productCollection"] = {
        $elemMatch: { slug: { $in: collectionArray } },
      };
    }
  }

  // Apply $or for category or subcategory
  if (filterConditions.length > 0) {
    filterQuery["$or"] = filterConditions;
  }

  const pipeline = [
    {
      $match: {
        isDeleted: false,
        publishedStatus: PRODUCT_STATUS.PUBLISHED,
      },
    },
    ...commonPipelineMultipleProduct,
    { $match: filterQuery },
    {
      $project: {
        price: {
          $cond: {
            if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
            then: {
              min: {
                $min: {
                  $map: {
                    input: "$variations",
                    as: "v",
                    in: {
                      $ifNull: [
                        "$$v.price.salePrice",
                        "$$v.price.regularPrice",
                      ],
                    },
                  },
                },
              },
              max: {
                $max: {
                  $map: {
                    input: "$variations",
                    as: "v",
                    in: {
                      $ifNull: [
                        "$$v.price.salePrice",
                        "$$v.price.regularPrice",
                      ],
                    },
                  },
                },
              },
            },
            else: {
              min: { $ifNull: ["$price.salePrice", "$price.regularPrice"] },
              max: { $ifNull: ["$price.salePrice", "$price.regularPrice"] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        minPrice: { $min: "$price.min" },
        maxPrice: { $max: "$price.max" },
      },
    },
    {
      $project: {
        _id: 0,
        minPrice: 1,
        maxPrice: 1,
      },
    },
  ];

  const result = await ProductModel.aggregate(pipeline as PipelineStage[]);

  return result.length > 0 ? result[0] : { minPrice: 0, maxPrice: 0 };
};

const updateProductIntoDB = async (
  updatedBy: Types.ObjectId,
  id: string,
  payload: Partial<TProductPayload>
) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const {
      price,
      image,
      inventory,
      seo,
      publishedStatus,
      attributes,
      brand,
      warrantyInfo,
      // tag,
      variations,
      ...remainingUpdateData
    } = payload;
    const isProductExist = await ProductModel.findById(id);

    if (!isProductExist) {
      throw new ApiError(httpStatus.NOT_FOUND, "The Product was not found!");
    }

    if (isProductExist.isDeleted) {
      throw new ApiError(httpStatus.BAD_REQUEST, "The Product is deleted!");
    }
    if (
      isProductExist.publishedStatus == PRODUCT_STATUS.PUBLISHED &&
      publishedStatus == PRODUCT_STATUS.DRAFT
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Published product can not be Draft! Make it private to hide it from customers."
      );
    }

    // Determine the target type for this update
    // If type is in payload use it, otherwise use existing type
    const productType = payload.type || isProductExist.type;

    // --- Simple Product Logic ---
    if (productType === PRODUCT_TYPE.SIMPLE) {
      if (price && Object.keys(price).length) {
        const { setFields, unsetFields } = formatPriceUpdatePayload(price);
        const priceUpdateOp: Record<string, unknown> = {
          $set: { ...setFields, updatedBy },
        };
        if (unsetFields.length > 0) {
          priceUpdateOp.$unset = Object.fromEntries(
            unsetFields.map((f) => [f, ""])
          );
        }
        await PriceModel.findByIdAndUpdate(
          isProductExist.price,
          priceUpdateOp,
          { session }
        );
      }

      if (inventory && Object.keys(inventory).length) {
        const existingInventory = await InventoryModel.findById(
          isProductExist.inventory
        );
        if (inventory.stockQuantity !== undefined) {
          if (
            existingInventory &&
            existingInventory.stockQuantity !== undefined
          ) {
            inventory.stockAvailable = calculateStockAvailable(
              inventory.stockQuantity,
              existingInventory.stockQuantity,
              existingInventory.stockAvailable || 0
            );
          }
        }

        const currentManageStock =
          inventory.manageStock !== undefined
            ? inventory.manageStock
            : existingInventory?.manageStock;
        const currentLowStockWarning =
          inventory.lowStockWarning !== undefined
            ? inventory.lowStockWarning
            : existingInventory?.lowStockWarning || 0;
        const currentStockAvailable =
          inventory.stockAvailable !== undefined
            ? inventory.stockAvailable
            : existingInventory?.stockAvailable || 0;

        if (currentManageStock) {
          inventory.stockStatus = calculateStockStatus(
            currentStockAvailable,
            currentLowStockWarning
          );
        }

        await InventoryModel.findByIdAndUpdate(
          isProductExist.inventory,
          { $set: { ...inventory, updatedBy } },
          { session }
        );
      }
    }

    const variationIds: Types.ObjectId[] = [];

    // --- Variable Product Logic ---
    if (productType === PRODUCT_TYPE.VARIABLE) {
      let index = 0;

      if (variations && variations.length > 0) {
        const priceBulkOps: any[] = [];
        const inventoryBulkOps: any[] = [];
        const variationBulkOps: any[] = [];
        const newVariationsData: any[] = [];

        // Fetch existing variations map for O(1) lookup
        const existingVariationModels = await VariationModel.find({
          productId: isProductExist.id,
        }).lean();

        const existingVariationMap = new Map(
          existingVariationModels.map((v) => [v._id.toString(), v])
        );

        // Fetch all related inventory documents for variations to avoid N+1 queries
        const variationInventoryIds = existingVariationModels.map(
          (v) => v.inventory
        );
        const existingInventories = await InventoryModel.find({
          _id: { $in: variationInventoryIds },
        }).lean();

        const inventoryMap = new Map(
          existingInventories.map((inv) => [inv._id.toString(), inv])
        );

        // Also map by attributes to help find match if ID is missing (legacy support)
        // Note: Object matching key order matters, simplistically using stringify here
        // but ideally should be robust. Given structure, ID match is preferred.

        for (const variation of variations) {
          const serial = index + 1;
          const {
            price: variationPrice,
            inventory: variationInventory,
            _id: variationId,
            ...variationData
          } = variation as any;

          let existingVariation: any = null;

          if (variationId && existingVariationMap.has(variationId)) {
            existingVariation = existingVariationMap.get(variationId);
          } else if (variationId) {
            // Fallback if not in map but ID provided (rare race condition or fetch gap)
            existingVariation = await VariationModel.findById(variationId);
          }

          if (!existingVariation) {
            // Fallback to attribute match if no ID
            existingVariation = await VariationModel.findOne({
              productId: isProductExist.id,
              attributes: variationData.attributes,
            });
          }

          if (existingVariation) {
            // Update existing variation
            if (variationPrice) {
              const { setFields, unsetFields } =
                formatPriceUpdatePayload(variationPrice);
              const variationPriceOp: Record<string, unknown> = {
                $set: setFields,
              };
              if (unsetFields.length > 0) {
                variationPriceOp.$unset = Object.fromEntries(
                  unsetFields.map((f) => [f, ""])
                );
              }
              priceBulkOps.push({
                updateOne: {
                  filter: { _id: existingVariation.price },
                  update: variationPriceOp,
                },
              });
            }
            if (variationInventory) {
              const currentInv = inventoryMap.get(
                existingVariation.inventory.toString()
              );

              // Calculate stock logic for variations
              if (variationInventory.stockQuantity !== undefined) {
                if (currentInv && currentInv.stockQuantity !== undefined) {
                  variationInventory.stockAvailable = calculateStockAvailable(
                    variationInventory.stockQuantity,
                    currentInv.stockQuantity,
                    currentInv.stockAvailable || 0
                  );
                }
              }

              const currentManageStock =
                variationInventory.manageStock !== undefined
                  ? variationInventory.manageStock
                  : currentInv?.manageStock;
              const currentLowStockWarning =
                variationInventory.lowStockWarning !== undefined
                  ? variationInventory.lowStockWarning
                  : currentInv?.lowStockWarning || 0;
              const currentStockAvailable =
                variationInventory.stockAvailable !== undefined
                  ? variationInventory.stockAvailable
                  : currentInv?.stockAvailable || 0;

              if (currentManageStock) {
                variationInventory.stockStatus = calculateStockStatus(
                  currentStockAvailable,
                  currentLowStockWarning
                );
              }

              inventoryBulkOps.push({
                updateOne: {
                  filter: { _id: existingVariation.inventory },
                  update: { $set: variationInventory },
                },
              });
            }

            variationBulkOps.push({
              updateOne: {
                filter: { _id: existingVariation._id },
                update: { $set: { serial, ...variationData } },
              },
            });
            variationIds.push(existingVariation._id);
          } else {
            // Create new variation data structure to hold temporarily
            if (variationInventory?.manageStock) {
              variationInventory.stockStatus = calculateStockStatus(
                variationInventory.stockAvailable || 0,
                variationInventory.lowStockWarning || 0
              );
            }

            // Let's collect new items to batch create them
            newVariationsData.push({
              serial,
              pricePayload: variationPrice,
              inventoryPayload: variationInventory,
              variationPayload: variationData,
            });
          }

          index++;
        }

        // Execute Bulk Updates
        if (priceBulkOps.length)
          await PriceModel.bulkWrite(priceBulkOps, { session });
        if (inventoryBulkOps.length)
          await InventoryModel.bulkWrite(inventoryBulkOps, { session });
        if (variationBulkOps.length)
          await VariationModel.bulkWrite(variationBulkOps, { session });

        // Handle New Variations Batch Creation
        if (newVariationsData.length > 0) {
          const newPrices = await PriceModel.insertMany(
            newVariationsData.map((v) => v.pricePayload),
            { session }
          );
          const newInventories = await InventoryModel.insertMany(
            newVariationsData.map((v) => v.inventoryPayload),
            { session }
          );

          const finalNewVariations = newVariationsData.map((v, idx) => ({
            productId: isProductExist.id,
            serial: v.serial,
            price: newPrices[idx]._id,
            inventory: newInventories[idx]._id,
            ...v.variationPayload,
          }));

          const createdVariations = await VariationModel.insertMany(
            finalNewVariations,
            { session }
          );
          createdVariations.forEach((v) => variationIds.push(v._id));
        }
      }
    }

    const updateImage: Record<string, unknown> = {};
    if (image && Object.keys(image).length) {
      for (const [key, value] of Object.entries(image)) {
        updateImage[`image.${key}`] = value;
      }
    }
    const updateWarrantyInfo: Record<string, unknown> = {};
    if (warrantyInfo && Object.keys(warrantyInfo).length) {
      for (const [key, value] of Object.entries(warrantyInfo)) {
        updateWarrantyInfo[`warrantyInfo.${key}`] = value;
      }
    }

    let updateAttribute, updateBrand, updateTag;

    // Only update attributes if type is variable
    if (productType === PRODUCT_TYPE.VARIABLE && attributes?.length) {
      updateAttribute = attributes;
    }

    if (brand) {
      updateBrand = brand;
    }
    // if (tag?.length) {
    //   updateTag = tag;
    // }
    const updateSeo: Record<string, unknown> = {};
    if (isProductExist.seo) {
      await SeoModel.findByIdAndUpdate(
        isProductExist.seo,
        { $set: { ...seo, updatedBy } },
        { session }
      );
    } else {
      const [seoDoc] = await SeoModel.create([seo], { session });
      updateSeo.seo = seoDoc._id;
    }

    const product = await ProductModel.findByIdAndUpdate(
      isProductExist._id,
      {
        $set: {
          ...updateImage,
          attributes: updateAttribute,
          brand: updateBrand,
          tag: updateTag,
          variations: variationIds,
          ...updateWarrantyInfo,
          ...updateSeo,
          ...(publishedStatus && { publishedStatus }),
          ...remainingUpdateData,
          updatedBy,
        },
      },
      { session, new: true }
    );

    await session.commitTransaction();
    return product;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const updateProductStatusIntoDB = async (
  productIds: string[],
  publishedStatus: string,
  updatedBy: Types.ObjectId
) => {
  const result = await ProductModel.updateMany(
    { _id: { $in: productIds } },
    {
      $set: {
        publishedStatus,
        updatedBy,
      },
    }
  );

  return result;
};

const deleteProductFromDB = async (
  productIds: string[],
  deletedBy: Types.ObjectId
) => {
  const result = await ProductModel.updateMany(
    { _id: { $in: productIds } },
    {
      $set: {
        deletedBy,
        isDeleted: true,
      },
    }
  );

  return result;
};

const generateFacebookCatalogXML = async () => {
  const products = await ProductModel.find({
    isDeleted: false,
    publishedStatus: "published",
  })
    .populate("price")
    .populate("inventory")
    .populate("brand")
    .populate("category")
    .populate("variations")
    .populate("image.thumbnail");

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("rss", {
      version: "2.0",
      "xmlns:g": "http://base.google.com/ns/1.0",
    })
    .ele("channel");

  root
    .ele("title")
    .txt(config.companyInfo?.name || "Store")
    .up();
  root.ele("link").txt(`https://${config.main_domain}`).up();
  root.ele("description").txt("Facebook Product Feed").up();

  for (const product of products) {
    const productUrl = `https://${config.main_domain}/product/${product.slug}`;

    // IMAGE
    const thumbnail = product?.image?.thumbnail as any;
    const imageUrl = thumbnail?.src ? mergeMediaBaseUrl(thumbnail.src) : "";

    // Description fallback
    const firstCategoryName =
      product.category && product.category.length > 0
        ? (product.category as any[])[0].name
        : "";
    let descriptionText = stripHtmlAndEntities(
      product.description ||
        product.shortDescription ||
        product.title ||
        firstCategoryName ||
        ""
    );

    // Truncate to maximum 5000 characters for catalog feed
    if (descriptionText.length > 5000) {
      descriptionText = descriptionText.substring(0, 4997) + "...";
    }

    // SIMPLE PRODUCT
    if (product.type === "simple") {
      const price: any = product.price;
      const inventory: any = product.inventory;

      const finalPrice = price?.salePrice || price?.regularPrice || 0;

      let availability = "out of stock";
      if (inventory?.stockStatus) {
        availability =
          inventory.stockStatus === "out_of_stock"
            ? "out of stock"
            : "in stock";
      } else if (inventory?.stockAvailable > 0) {
        availability = "in stock";
      }

      const item = root.ele("item");

      item.ele("g:id").txt(product._id.toString()).up();
      item.ele("g:title").txt(stripHtmlAndEntities(product.title)).up();
      item.ele("g:description").txt(descriptionText).up();
      item.ele("g:availability").txt(availability).up();
      item.ele("g:condition").txt("new").up();
      item
        .ele("g:price")
        .txt(`${Number(finalPrice).toFixed(2)} BDT`)
        .up();
      item.ele("g:link").txt(productUrl).up();

      if (imageUrl) {
        item.ele("g:image_link").txt(imageUrl).up();
      }

      if (product.brand) {
        item
          .ele("g:brand")
          .txt((product.brand as any).name)
          .up();
      }

      if (product.category && product.category.length > 0) {
        const categories = (product.category as any[])
          .map((c) => c.name)
          .join(" > ");
        item.ele("g:google_product_category").txt(categories).up();
        item.ele("g:product_type").txt(categories).up();
      }

      // Meta rules: Since no GTIN/MPN is present
      item.ele("g:identifier_exists").txt("no").up();
    }

    // VARIABLE PRODUCT
    if (product.type === "variable" && product.variations?.length) {
      const variations = await VariationModel.find({
        _id: { $in: product.variations },
        isDeleted: false,
        isActive: true,
      })
        .populate("price")
        .populate("inventory");

      for (const variation of variations) {
        const price: any = variation.price;
        const inventory: any = variation.inventory;

        const finalPrice = price?.salePrice || price?.regularPrice || 0;

        let availability = "out of stock";
        if (inventory?.stockStatus) {
          availability =
            inventory.stockStatus === "out_of_stock"
              ? "out of stock"
              : "in stock";
        } else if (inventory?.stockAvailable > 0) {
          availability = "in stock";
        }

        const variantId = `${product._id.toString()}-${variation._id.toString()}`;

        const item = root.ele("item");

        item.ele("g:id").txt(variantId).up();
        item.ele("g:item_group_id").txt(product._id.toString()).up();

        // title with attributes
        let title = product.title;
        if (variation.attributes) {
          const attrs = Object.values(
            Object.fromEntries(variation.attributes as any)
          );
          title += " - " + attrs.join(" ");
        }

        item.ele("g:title").txt(stripHtmlAndEntities(title)).up();
        item.ele("g:description").txt(descriptionText).up();
        item.ele("g:availability").txt(availability).up();
        item.ele("g:condition").txt("new").up();
        item
          .ele("g:price")
          .txt(`${Number(finalPrice).toFixed(2)} BDT`)
          .up();
        item.ele("g:link").txt(productUrl).up();

        if (imageUrl) {
          item.ele("g:image_link").txt(imageUrl).up();
        }

        if (product.brand) {
          item
            .ele("g:brand")
            .txt((product.brand as any).name)
            .up();
        }

        if (product.category && product.category.length > 0) {
          const categories = (product.category as any[])
            .map((c) => c.name)
            .join(" > ");
          item.ele("g:google_product_category").txt(categories).up();
          item.ele("g:product_type").txt(categories).up();
        }

        // Meta rules: Since no GTIN/MPN is present
        item.ele("g:identifier_exists").txt("no").up();

        // optional: color/size mapping
        if (variation.attributes) {
          const attrs = Object.fromEntries(variation.attributes as any);
          if (attrs.color) {
            item.ele("g:color").txt(attrs.color).up();
          }
          if (attrs.size) {
            item.ele("g:size").txt(attrs.size).up();
          }
        }
      }
    }
  }

  return root.end({ prettyPrint: true });
};

export const ProductServices = {
  createProductIntoDB,
  getAProductCustomerFromDB,
  getAProductAdminFromDB,
  getAllProductsCustomerFromDB,
  getAllProductsAdminFromDB,
  getFeaturedProductsFromDB,
  getBestSellingProductsFromDB,
  getRelatedProductsFromDB,
  updateProductIntoDB,
  updateProductStatusIntoDB,
  deleteProductFromDB,
  getProductPriceRangeFromDB,
  generateFacebookCatalogXML,
};
