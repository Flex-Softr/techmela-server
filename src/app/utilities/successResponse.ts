import { Response } from "express";
import { attachMediaBaseUrls } from "./mediaPath";

export type TResponseMeta = {
  page: number;
  limit: number;
  total: number;
};

type TSuccessResponse<T> = {
  statusCode: number;
  success?: true;
  message?: string | null;
  meta?: TResponseMeta | null;
  data?: T | null;
};

const successResponse = <T>(res: Response, data: TSuccessResponse<T>) => {
  const transformedData =
    data?.data !== undefined && data?.data !== null
      ? attachMediaBaseUrls(data.data)
      : data?.data;

  const responseData: TSuccessResponse<T> = {
    success: true,
    statusCode: data?.statusCode,
    message: data?.message || "Operation success",
    meta: data.meta || null || undefined,
    data: transformedData || null || undefined,
  };
  res.status(data?.statusCode).json(responseData);
};

export default successResponse;
