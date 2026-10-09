import { CookieOptions, NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { Secret } from "jsonwebtoken";
import config from "../config/config";
import { PERMISSIONS } from "../const/permission.const";
import ApiError from "../errorHandlers/ApiError";
import { jwtHelper } from "../helper/jwt.helper";
import { TJwtPayload } from "../modules/authManagement/auth/auth.interface";
import {
  TPermission,
  TPermissionNames,
} from "../modules/userManagement/permission/permission.interface";
import { ROLES } from "../modules/userManagement/user/user.const";
import { TRoles, TUser } from "../modules/userManagement/user/user.interface";
import { User } from "../modules/userManagement/user/user.model";

function areArraysEqual(
  arr1: TPermission[],
  arr2: { _id: string; name: string }[]
): boolean {
  return (
    arr1?.length === arr2?.length &&
    arr1.every((value) => arr2.map((item) => item.name).includes(value.name))
  );
}

const authGuard =
  ({
    requiredRoles,
    requiredPermission,
  }: {
    requiredRoles: TRoles[];
    requiredPermission?: TPermissionNames;
  }) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let token = req?.headers?.authorization;
      if (token) {
        token = token?.split(" ")[1];
      } else {
        token = req?.cookies["_app.ec.at"];
      }
      if (!token) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized request");
      }

      const verifiedUser = jwtHelper.verifyToken<TJwtPayload>(
        token,
        config.token_data.access_token_secret as Secret
      );

      if (
        requiredRoles.length &&
        !requiredRoles.includes(verifiedUser?.role as TRoles)
      ) {
        throw new ApiError(httpStatus.FORBIDDEN, "Not valid user");
      }

      if (verifiedUser.role !== ROLES.CUSTOMER) {
        const user = await User.isUserExist({ _id: verifiedUser.id });
        verifiedUser.data = user as unknown as TUser;
        if (user?.role !== verifiedUser.role) {
          throw new ApiError(httpStatus.FORBIDDEN, "Not valid user");
        }

        // Usage
        const isEqual = areArraysEqual(
          user?.permissions as TPermission[],
          verifiedUser.permissions
        );

        if (!isEqual) {
          const accessToken = jwtHelper.createToken(
            {
              id: user?._id.toString(),
              role: user?.role as string,
              permissions:
                (user?.permissions?.map(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (item: any) => ({ _id: item._id, name: item.name })
                ) as unknown as { _id: string; name: string }[]) || [],
              uid: user?.uid as string,
              // sessionId: isTokenExist.sessionId,
            },
            config.token_data.access_token_secret as Secret,
            config.token_data.access_token_expires as string
          );
          const cookieOption: CookieOptions = {
            domain:
              config.env === "production" && config.main_domain
                ? `.${config.main_domain}`
                : undefined,
            httpOnly: config.env === "production",
            secure: config.env === "production",
            sameSite: "lax",
            maxAge: Number(config.token_data.access_token_cookie_expires),
          };

          res.cookie("_app.ec.at", accessToken, cookieOption);
        }
        // if (!isEqual) {
        //   const domain =
        //     config.env === "production"
        //       ? `.${config.main_domain}`
        //       : "localhost";

        //   res.clearCookie("_app.ec.at", {
        //     path: "/",
        //     domain,
        //   });
        //   res.clearCookie("_app.ec.rt", {
        //     path: "/",
        //     domain,
        //   });
        // }

        if (requiredPermission) {
          if (
            !user?.permissions.some(
              (item) =>
                (item as TPermission).name === requiredPermission ||
                (item as TPermission).name === PERMISSIONS.SUPER_ADMIN
            )
          ) {
            throw new ApiError(httpStatus.FORBIDDEN, "Permission denied");
          }
        }
      }

      req.user = verifiedUser;
      next();
    } catch (error) {
      next(error);
    }
  };

export default authGuard;
