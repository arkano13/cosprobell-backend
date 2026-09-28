export class AppError extends Error {
  constructor({ code, message, statusCode = 400 }) {
   if (typeof code !== "string" || code.trim() === "") {
      throw new TypeError("AppError requiere un code no vacío");
    }

    if (typeof message !== "string" || message.trim() === "") {
      throw new TypeError("AppError requiere un message no vacío");
    }

    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new TypeError(
        "AppError requiere un statusCode entero entre 400 y 599",
      );
    }

    super(message.trim());
     this.name = "AppError";
    this.code = code.trim();
    this.statusCode = statusCode;
     Error.captureStackTrace?.(this, AppError);
  }
}
