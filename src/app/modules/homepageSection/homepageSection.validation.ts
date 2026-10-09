import { z } from "zod";

const createHomepageSection = z.object({
  body: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    image: z.string().optional().nullable(),
    collectionId: z.string({ required_error: "Collection ID is required!" }),
    limit: z.number().optional(),
    sortOrder: z.number().optional(),
    ctaText: z.string().optional(),
    ctaLink: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateHomepageSection = z.object({
  body: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    image: z.string().optional().nullable(),
    collectionId: z.string().optional(),
    limit: z.number().optional(),
    sortOrder: z.number().optional(),
    ctaText: z.string().optional(),
    ctaLink: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const HomepageSectionValidation = {
  createHomepageSection,
  updateHomepageSection,
};
