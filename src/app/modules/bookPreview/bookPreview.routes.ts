import { Router } from "express";
import authGuard from "../../middlewares/authGuard";

import { ROLES } from "../userManagement/user/user.const";
import { BookPreviewControllers } from "./bookPreview.controller";
import { uploadMemory } from "../../config/multer.config";

const router = Router();

router.post(
  "/presigned-url",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] }),
  BookPreviewControllers.generatePresignedUrl
);

router.post(
  "/",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] }),
  uploadMemory.any(),
  BookPreviewControllers.createBookPreview
);

router.get("/:id", BookPreviewControllers.getABookPreview);

router.get("/", BookPreviewControllers.getAllBookPreviews);

router.delete(
  "/",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN] }),
  BookPreviewControllers.deleteBookPreviews
);

export const BookPreviewRoutes = router;
