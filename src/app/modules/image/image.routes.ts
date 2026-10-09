import { Router } from "express";
import authGuard from "../../middlewares/authGuard";

import { ROLES } from "../userManagement/user/user.const";
import { ImageControllers } from "./image.controller";
import { uploadMemory } from "../../config/multer.config";

const router = Router();

router.post(
  "/presigned-url",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] }),
  ImageControllers.generatePresignedUrl
);

router.post(
  "/",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] }),
  uploadMemory.any(),
  ImageControllers.createImage
);

router.get(
  "/:id",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] }),
  ImageControllers.getAnImage
);

router.get(
  "/",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] }),
  ImageControllers.getAllImages
);

router.delete(
  "/",
  authGuard({ requiredRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN] }),
  ImageControllers.deleteImages
);

export const ImageRoutes = router;
