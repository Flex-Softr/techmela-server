import { PipelineStage } from "mongoose";
import { STOCK_STATUS } from "../inventory/inventory.const";
import { PRODUCT_TYPE } from "./product.const";

export const formatPriceUpdatePayload = (
  price: Record<string, unknown>
): { setFields: Record<string, unknown>; unsetFields: string[] } => {
  const regularPrice = Number(price.regularPrice) || 0;
  const rawSalePrice = price.salePrice;
  const salePrice =
    rawSalePrice !== undefined && rawSalePrice !== null && rawSalePrice !== ""
      ? Number(rawSalePrice)
      : 0;

  const setFields: Record<string, unknown> = { regularPrice };
  const unsetFields: string[] = [];

  if (salePrice > 0 && salePrice < regularPrice) {
    setFields.salePrice = salePrice;
    setFields.discountPercent = Math.round(
      ((regularPrice - salePrice) / regularPrice) * 100
    );
    setFields.priceSave = regularPrice - salePrice;
  } else {
    // No valid sale price — clear all derived sale fields
    unsetFields.push("salePrice", "discountPercent", "priceSave");
  }

  return { setFields, unsetFields };
};

export const calculateStockAvailable = (
  newStockQuantity: number,
  oldStockQuantity: number,
  oldStockAvailable: number
): number => {
  const diff = Number(newStockQuantity) - Number(oldStockQuantity);
  return (oldStockAvailable || 0) + diff;
};

export const commonProductProjection = {
  _id: 1,
  id: 1,
  title: 1,
  slug: 1,
  previewLink: 1,
  type: 1,
  createdAt: 1,
  updatedAt: 1,
  // variations: 1,
  // shortDescription: 1,

  // Pricing Logic with conditional handling for variable products
  regularPrice: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: "$$REMOVE",
      else: "$price.regularPrice",
    },
  },
  salePrice: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: "$$REMOVE",
      else: "$price.salePrice",
    },
  },
  discountPercent: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: "$$REMOVE",
      else: "$price.discountPercent",
    },
  },
  priceSave: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: "$$REMOVE",
      else: "$price.priceSave",
    },
  },
  // Variable Product Specific Fields
  minRegularPrice: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $min: "$variations.price.regularPrice" },
      else: "$$REMOVE",
    },
  },
  minSalePrice: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $min: "$variations.price.salePrice" },
      else: "$$REMOVE",
    },
  },
  maxRegularPrice: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $max: "$variations.price.regularPrice" },
      else: "$$REMOVE",
    },
  },
  maxSalePrice: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $max: "$variations.price.salePrice" },
      else: "$$REMOVE",
    },
  },
  minDiscountPercent: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $min: "$variations.price.discountPercent" },
      else: "$$REMOVE",
    },
  },
  maxDiscountPercent: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $max: "$variations.price.discountPercent" },
      else: "$$REMOVE",
    },
  },
  minPriceSave: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $ifNull: [{ $min: "$variations.price.priceSave" }, 0] },
      else: "$$REMOVE",
    },
  },
  maxPriceSave: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: { $ifNull: [{ $max: "$variations.price.priceSave" }, 0] },
      else: "$$REMOVE",
    },
  },

  // Stock Status Logic
  stockStatus: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: {
        $cond: {
          if: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: {
                      $ifNull: ["$variations.inventory.stockStatus", []],
                    },
                    as: "status",
                    cond: {
                      $in: [
                        "$$status",
                        [STOCK_STATUS.IN_STOCK, STOCK_STATUS.LOW_STOCK],
                      ],
                    },
                  },
                },
              },
              0,
            ],
          },
          then: STOCK_STATUS.IN_STOCK,
          else: STOCK_STATUS.OUT_OF_STOCK,
        },
      },
      else: "$inventory.stockStatus", // Simple product logic
    },
  },
  // sku: "$inventory.sku",
  // stockAvailable: "$inventory.stockAvailable",
  totalReview: { $size: { $ifNull: ["$review", []] } },
  averageRating: { $avg: { $ifNull: ["$review.rating", []] } },
  thumbnail: {
    _id: "$thumbnail._id",
    src: "$thumbnail.src",
    alt: "$thumbnail.alt",
  },
  image: {
    _id: "$thumbnail._id",
    src: "$thumbnail.src",
    alt: "$thumbnail.alt",
  },
  // Calculated active price for sorting (salePrice if exists, else regularPrice)
  price: {
    $cond: {
      if: { $eq: ["$type", PRODUCT_TYPE.VARIABLE] },
      then: {
        $min: {
          $map: {
            input: "$variations.price",
            as: "vp",
            in: { $ifNull: ["$$vp.salePrice", "$$vp.regularPrice"] },
          },
        },
      },
      else: { $ifNull: ["$price.salePrice", "$price.regularPrice"] },
    },
  },
};

export const commonPipelineSingleProduct = (
  pipeline: PipelineStage[] | undefined = []
): PipelineStage[] => [
  {
    $lookup: {
      from: "images",
      localField: "image.thumbnail",
      foreignField: "_id",
      as: "thumbnail",
      pipeline: [
        {
          $project: {
            src: "$src",
            alt: 1,
          },
        },
      ],
    },
  },
  {
    $lookup: {
      from: "images",
      localField: "image.gallery",
      foreignField: "_id",
      as: "gallery",
      pipeline: [
        {
          $project: {
            src: "$src",
            alt: 1,
          },
        },
      ],
    },
  },
  {
    $lookup: {
      from: "prices",
      localField: "price",
      foreignField: "_id",
      as: "price",
      pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
    },
  },
  {
    $lookup: {
      from: "inventories",
      localField: "inventory",
      foreignField: "_id",
      as: "inventory",
      pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
    },
  },
  {
    $lookup: {
      from: "variations",
      localField: "variations",
      foreignField: "_id",
      as: "variations",
      pipeline: [
        ...(pipeline || []),
        { $sort: { serial: 1 } },
        {
          $lookup: {
            from: "prices",
            localField: "price",
            foreignField: "_id",
            as: "price",
            pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
          },
        },
        {
          $unwind: { path: "$price", preserveNullAndEmptyArrays: true },
        },
        {
          $lookup: {
            from: "inventories",
            localField: "inventory",
            foreignField: "_id",
            as: "inventory",
            pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
          },
        },
        {
          $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            createdAt: 0,
            updatedAt: 0,
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any[],
    },
  },
  {
    $lookup: {
      from: "categories",
      localField: "category",
      foreignField: "_id",
      as: "category",
      pipeline: [{ $project: { _id: 1, name: 1, slug: 1 } }],
    },
  },
  {
    $lookup: {
      from: "attributes",
      localField: "attributes.name",
      foreignField: "_id",
      as: "myAttributes",
      pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
    },
  },
  {
    $lookup: {
      from: "brands",
      localField: "brand",
      foreignField: "_id",
      as: "brand",
      pipeline: [{ $project: { name: 1, slug: 1 } }],
    },
  },
  {
    $lookup: {
      from: "collections",
      localField: "productCollection",
      foreignField: "_id",
      as: "productCollection",
      pipeline: [{ $project: { name: 1, slug: 1 } }],
    },
  },
  {
    $lookup: {
      from: "seos",
      localField: "seo",
      foreignField: "_id",
      as: "seo",
      pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
    },
  },
  {
    $unwind: { path: "$seo", preserveNullAndEmptyArrays: true },
  },
  {
    $unwind: { path: "$thumbnail", preserveNullAndEmptyArrays: true },
  },
  {
    $unwind: { path: "$price", preserveNullAndEmptyArrays: true },
  },
  {
    $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true },
  },
  {
    $unwind: { path: "$brand", preserveNullAndEmptyArrays: true },
  },
  // {
  //   $unwind: { path: "$productCollection", preserveNullAndEmptyArrays: true },
  // },
  {
    $project: {
      _id: 1,
      id: 1,
      title: 1,
      slug: 1,
      previewLink: 1,
      type: 1,
      featured: 1,
      shortDescription: 1,
      description: 1,
      // additionalInfo: 1,
      // usageGuidelines: 1,
      thumbnail: "$thumbnail",
      image: "$thumbnail",
      gallery: "$gallery",
      price: "$price",
      inventory: "$inventory",
      variations: "$variations",
      category: "$category",
      attributes: {
        $map: {
          input: "$myAttributes",
          as: "a",
          in: {
            _id: "$$a._id",
            name: "$$a.name",
            values: {
              $filter: {
                input: "$$a.values",
                as: "value",
                cond: {
                  $in: [
                    "$$value._id",
                    {
                      $arrayElemAt: [
                        {
                          $map: {
                            input: {
                              $filter: {
                                input: "$attributes",
                                as: "s",
                                cond: { $eq: ["$$s.name", "$$a._id"] },
                              },
                            },
                            as: "sa",
                            in: "$$sa.values",
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
      brand: "$brand",
      productCollection: "$productCollection",
      relatedProducts: 1,
      warranty: 1,
      warrantyInfo: 1,
      seo: "$seo",
      publishedStatus: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  },
];

export const commonPipelineMultipleProduct: PipelineStage[] = [
  {
    $lookup: {
      from: "prices",
      localField: "price",
      foreignField: "_id",
      as: "price",
    },
  },
  {
    $unwind: { path: "$price", preserveNullAndEmptyArrays: true },
  },
  {
    $lookup: {
      from: "images",
      localField: "image.thumbnail",
      foreignField: "_id",
      as: "thumbnail",
      pipeline: [
        {
          $project: {
            src: "$src",
            alt: 1,
          },
        },
      ],
    },
  },
  {
    $unwind: { path: "$thumbnail", preserveNullAndEmptyArrays: true },
  },
  {
    $lookup: {
      from: "inventories",
      localField: "inventory",
      foreignField: "_id",
      as: "inventory",
    },
  },
  {
    $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true },
  },
  {
    $lookup: {
      from: "categories",
      localField: "category",
      foreignField: "_id",
      as: "category",
      pipeline: [{ $project: { _id: 1, name: 1, slug: 1 } }],
    },
  },
  {
    $lookup: {
      from: "variations",
      localField: "variations",
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
            pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
          },
        },
        {
          $unwind: { path: "$price", preserveNullAndEmptyArrays: true },
        },
        {
          $lookup: {
            from: "inventories",
            localField: "inventory",
            foreignField: "_id",
            as: "inventory",
            pipeline: [{ $project: { createdAt: 0, updatedAt: 0 } }],
          },
        },
        {
          $unwind: { path: "$inventory", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            createdAt: 0,
            updatedAt: 0,
          },
        },
      ],
    },
  },
  {
    $lookup: {
      from: "brands",
      localField: "brand",
      foreignField: "_id",
      as: "brand",
      pipeline: [{ $project: { name: 1, slug: 1 } }],
    },
  },
  {
    $unwind: { path: "$brand", preserveNullAndEmptyArrays: true },
  },
  {
    $lookup: {
      from: "collections",
      localField: "productCollection",
      foreignField: "_id",
      as: "productCollection",
      pipeline: [{ $project: { name: 1, slug: 1 } }],
    },
  },
  {
    $lookup: {
      from: "reviews",
      localField: "_id",
      foreignField: "product",
      as: "review",
    },
  },
];

export const stripHtmlAndEntities = (str: string): string => {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace &nbsp; with space
    .trim();
};
