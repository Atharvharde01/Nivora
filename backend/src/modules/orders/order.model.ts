import mongoose from "mongoose";
import { IOrder, OrderModelType } from "./order.types";
import { OrderSchema } from "./order.schema";

export const ORDER_MODEL_NAME = "Order";
export const ORDER_COLLECTION_NAME = "orders";

export const OrderModel: OrderModelType =
  (mongoose.models[ORDER_MODEL_NAME] as OrderModelType | undefined) ??
  mongoose.model<IOrder>(
    ORDER_MODEL_NAME,
    OrderSchema,
    ORDER_COLLECTION_NAME
  );
