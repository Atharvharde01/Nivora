import { model } from "mongoose";
import { OrdersSchema, IOrder } from "../schemas/OrdersSchema";

export const OrdersModel = model<IOrder>("order", OrdersSchema);
