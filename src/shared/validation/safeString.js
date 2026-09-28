import { z } from "zod";

export const safeString = (min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .refine((s) => !s.includes("\u0000"), {
      message: "No debe contener el caracter nulo",
    });