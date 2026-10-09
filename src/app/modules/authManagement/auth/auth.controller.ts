import { CookieOptions, Request, Response } from "express";
import httpStatus from "http-status";
import config from "../../../config/config";
import catchAsync from "../../../utilities/catchAsync";
import successResponse from "../../../utilities/successResponse";
import { ROLES } from "../../userManagement/user/user.const";
import {
  TJwtPayload,
  // TLoginResponse,
  TRefreshTokenResponse,
} from "./auth.interface";
import { AuthServices } from "./auth.service";

const login = catchAsync(async (req: Request, res: Response) => {
  const { ...payload } = req.body;
  const result = await AuthServices.login(req, payload);
  const { user, accessToken, refreshToken } = result;

  // const user = { role: "" }
  // const accessToken = "testacesstoken"
  // const refreshToken = "testrefreshToken"

  const customerRfExpires = config.token_data
    .customer_refresh_token_cookie_expires as string;
  const adminOrStaffRefExpires = config.token_data
    .admin_staff_refresh_token_cookie_expires as string;
  const refreshExpires =
    user?.role === ROLES.CUSTOMER ? customerRfExpires : adminOrStaffRefExpires;

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
  cookieOption.maxAge = Number(refreshExpires);
  res.cookie("_app.ec.rt", refreshToken, cookieOption);

  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Logged in successfully!",
    data: { accessToken },
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const refreshToken = req.headers.authorization || req.cookies["_app.ec.rt"];
  const { accessToken } = await AuthServices.refreshToken(
    req.clientIp as string,
    req.ecSID.id,
    refreshToken
  );
  // const accessToken=refreshToken
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
  // res.cookie("_app.ec.at", "", { expires: new Date(0) });
  // console.log("_app.ec.at", accessToken, Date.now())
  res.cookie("_app.ec.at", accessToken, cookieOption);
  successResponse<TRefreshTokenResponse>(res, {
    statusCode: httpStatus.OK,
    message: "Access token retrieved successfully!",
    data: { accessToken },
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const { ...passwordData } = req.body;
  await AuthServices.changePassword(passwordData, req.user as TJwtPayload);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "The password was changed successfully.",
  });
});

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  const { refreshToken } = req.cookies;
  await AuthServices.logoutUser(refreshToken);
  req.ecSID.newId();
  const cookieOption: CookieOptions = {
    domain:
      config.env === "production" && config.main_domain
        ? `.${config.main_domain}`
        : undefined,
    httpOnly: config.env === "production",
    secure: config.env === "production",
    sameSite: "lax",
    expires: new Date(0),
  };
  res.cookie("_app.ec.rt", "", cookieOption);
  res.cookie("_app.ec.at", "", cookieOption);

  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Logged out successfully.",
  });
});

const getLoggedInDevices = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.user as TJwtPayload;
  const result = await AuthServices.getLoggedInDevicesFromDB(id);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Logged-in devices were retrieved successfully.",
    data: result,
  });
});

const forgetPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.forgetPassword(req);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Password reset OTP has been sent to your email.",
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthServices.resetPassword(req.ecSID.id, req.body);
  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "The password was reset successfully..",
  });
});

const deleteAccount = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as TJwtPayload;
  await AuthServices.deleteAccount(user.id);

  // Clear auth cookies
  const cookieOption = {
    domain:
      config.env === "production" && config.main_domain
        ? `.${config.main_domain}`
        : undefined,
    httpOnly: config.env === "production",
    secure: config.env === "production",
    sameSite: "lax" as const,
    expires: new Date(0),
  };
  res.cookie("_app.ec.rt", "", cookieOption);
  res.cookie("_app.ec.at", "", cookieOption);

  successResponse(res, {
    statusCode: httpStatus.OK,
    message: "Account deleted successfully.",
  });
});

export const AuthControllers = {
  login,
  refreshToken,
  changePassword,
  logoutUser,
  getLoggedInDevices,
  forgetPassword,
  resetPassword,
  deleteAccount,
};
